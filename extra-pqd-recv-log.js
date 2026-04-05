#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import hexdump from 'hexdump-nodejs';
import protobuf from 'protobufjs';
import moment from 'moment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var DataMsgType;

function seqnoDiff(a, b)
{
    const range = 2**32;
    var n = (a + (range - b)) % range;
    return n >= range/2 ? -(range - n) : n;
}

function timezoneToMsAdj(timezone)
{
    var hh, mm;
    if (timezone.length != 5
        || (timezone[0] != '+' && timezone[0] != '-'))
        return null;
    hh = parseInt(timezone.slice(1, 3));
    mm = parseInt(timezone.slice(3, 5));
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59)
        return null;
    return hh * 3600e3 + mm * 60e3; 
}

function decodeProtobuf(buf)
{
    return DataMsgType.decode(buf);
}

function detectDataBotPostEvent(log, opts)
{
    const dataBotPostPat = 'Received SecureDatabotResource DoPost: Request ID:';
    var pos;
    var ma;
    var reqId;
    var srcIp;
    var srcPort;
    var payload;
    var devId;
    var msgId;

    pos = log.msg.search(dataBotPostPat);
    if (pos < 0) return null;

    const lines = log.msg.split('\n');
    reqId = parseInt(lines[0].slice(pos + dataBotPostPat.length));
    if (lines.length < 3) {
        console.error(`No enough log in post info [${log.lineNo}]:`, log.msg);
        return null;
    }

    ma = lines[1].match(/Source: ([0-9.]+):([0-9]+)/);
    if (!ma) {
        console.error(`Addr missed in post info [${log.lineNo}]:`
            , log.msg);
        return null;
    }
    srcIp = ma[1];
    srcPort = parseInt(ma[2]);

    pos = lines[2].search('AppOS Payload: ');
    if (pos < 0) {
        console.error(`AppOS Payload missed in post info [${log.lineNo}]:`
            , log.msg);
        return null;
    }
    payload = Buffer.from(
        lines[2].slice(pos + 'AppOS Payload '.length).trim(),
        'base64');
    if (payload[0] != 1) {
        console.error(`Incorrect message verson in post info [${log.lineNo}]:`
            , log.msg);
        return null;
    }
    devId = payload.readUint32BE(1);
    if (devId != opts.devId) return null;
    const tmp = payload.slice(5, 9); 
    const ctrl = tmp[3];
    tmp[3] = 0;
    msgId = payload.readUint32BE(0) >> 8;
    return {
        lineNo: log.lineNo,
        timestamp: log.timestamp,
        type: 'databot-post',
        senderAddr: { ip: srcIp, port: srcPort },
        devId,
        encrypted: (ctrl & 1) == 0,
        singed: (ctrl & 2) != 0,
        hasHmac: (ctrl & 4) != 0,
        msgId,
        reqId,
    };
}

function detectProcDataMsgAsync(log, opts)
{
    const procDataMsgAsyncPat = 'Inside ProcessDataAsync';
    const lines = log.msg.split('\n');
    var ma;

    if (log.msg.search(procDataMsgAsyncPat) < 0)
        return null;
    if (lines.length < 2) return null;
    ma = lines[1].match(/Message ID : ([0-9.]+)/);
    if (!ma) return null;
    return {
        lineNo: log.lineNo,
        timestamp: log.timestamp,
        type: '_procDataMsgAsync',
        reqId: parseInt(ma[1]),
    };
}
 
function detectDataMsgEvent(log, opts)
{
    const dataMsgPat = 'DataBot_DataMsg.NodeID : ';
    var pos;
    var devId;
    var str;

    pos = log.msg.search(dataMsgPat);
    if (pos < 0) return null;

    const lines = log.msg.split('\n');
    devId = parseInt(lines[0].slice(pos + dataMsgPat.length), 16);
    if (devId != opts.devId) return null;
    if (lines.length < 2) {
        console.error(`No enough log in message-proc info [${log.lineNo}]:`
            , log.msg);
        return null;
    }

    pos = lines[1].search('DataBot_DataMsg : ');
    if (pos < 0) {
        console.error(`Invalid message-proc info [${log.lineNo}]:`, log.msg);
        return null;
    }
    str = lines[1].slice(pos + 'DataBot_DataMsg : '.length);
    try {
        const msg = JSON.parse(str);
        msg.dataTransport.appData[0].payloadBytes
            = decodeProtobuf(Buffer.from(
                msg.dataTransport.appData[0].payloadBytes, 'base64'));
        return {
            lineNo: log.lineNo,
            timestamp: log.timestamp,
            type: 'data-msg',
            devId,
            msg,
        };
    } catch (e) {
        console.error('Invalid DataMsg:', log.msg);
    }
    return null;
}

function detectEvent(log, devId)
{
    var e = null;

    (e = detectDataBotPostEvent(log, { devId }))
        || (e = detectDataMsgEvent(log, { devId }))
        || (e = detectProcDataMsgAsync(log, { devId }))
    return e;
}

function loadDataMsgType()
{
    return new Promise((resolve, reject) => {
        protobuf.load(path.join(__dirname, 'meter-power-quality.json')
            , (err, root) => {
                if (err) return reject(new Error(err));
                try {
                    resolve(root.lookupType('landisgyr.protobuf.PowerQualityData'));
                } catch (e) {
                    reject(e.message);
                }
            });
    });
}

async function scanAppMgrLog(filename, devId)
{
    const rl = createInterface({
        input: createReadStream(filename),
    });
    var lineNo = 0;
    var lineNoBegin;
    var partial = [];
    var events = [];
    var reqId = -1;

    for await (const line of rl) {
        ++lineNo;
        if (!line.search(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}\s/)) {
            if (partial.length) {
                const parts = partial[0].split(/ - /);
                const timestamp = moment(parts[0] + ' ' + '+0000'
                    , 'YYYY-MM-DD hh:mm:ss,SSS ZZ', true);
                const e = detectEvent({
                    lineNo: lineNoBegin,
                    timestamp,
                    msg: [parts[11], ...partial.slice(1)].join('\n').trim(),
                }, devId);
                if (e) {
                    //console.log(e);
                    if (e.type == '_procDataMsgAsync') {
                        reqId = e.reqId;
                    } else if (e.type == 'data-msg') {
                        events.push({...e, reqId});
                        reqId = null;
                    } else {
                        events.push({...e});
                    }
                }
            }
            partial = [line];
            lineNoBegin = lineNo;
        } else
            partial.push(line);
    }
    return events;
}

function calcDataMsgTiming(events)
{
    const sane = [];

    for (let i = 0; i < events.length; ++i) {
        const e = events[i];
        if (!i) {
            sane.push(e);
            continue;
        }
        const prev = events[i-1];
    }
}

function amendRecvTimeForDataMsg(events)
{
    const proc = [];
    const amended = [];
    var post = [];
    var orphanDataMsg = [];

    for (const e of events) {
        if (e.type == 'databot-post') {
            post.push(e);
            continue;
        }
        if (e.type == 'data-msg') {
            var post_right = [];
            var p = post.pop();
            while (p != undefined) {
                if (p.reqId == e.reqId) {
                    amended.push({ ...e, recvTime: p.timestamp });
                    break;
                }
                post_right.unshift(p);
                p = post.pop();
            }
            if (p == undefined) {
                orphanDataMsg.push(e);
                amended.push({ ...e, recvTime: e.timestamp });
            }
            post = [...post, ...post_right];
        }
    }
    if (orphanDataMsg.length) {
        console.warn(`Found ${post.length} orphan data-msg w/o data-post:`);
        for (const p of orphanDataMsg) {
            console.warng(JSON.stringyfy(p, null, 2));
        }
    }
    if (post.length) {
        console.warn(`Found ${post.length} orphan data-post`
            + ` not been processed:`);
        for (const p of post) {
            console.warng(JSON.stringyfy(p, null, 2));
        }
    }
    return { dataMsg: amended, orphanPost: post };
}

function calcDelays(dataMsgList)
{
    const amended = [];
    var zoneAdj = 0;

    for (const d of dataMsgList) {
        const pqd = d.msg.dataTransport.appData[0].payloadBytes;
        const senderTime = parseInt(pqd.timestamp.seconds) * 1e3
            + parseInt(pqd.timestamp.nanos/1e6);
        const procDelay = /*(d.recvTime != null) ?*/ d.timestamp - d.recvTime
            /*: 0*/;
        const travelDelay = /*d.recvTime != null ?*/
            d.recvTime.valueOf() - senderTime /*:
            d.timestamp - senderTime*/;
        amended.push({ ...d, procDelay, travelDelay });
    }
    return amended;
}

function writeTimingCsv(dataMsgList, filename)
{
    const csv = fs.createWriteStream(filename);

    csv.write('DevId,Seqno,LogLine,RecvTime,TravelDelay,ProcDelay\n');
    for (const d of dataMsgList) {
        const pqd = d.msg.dataTransport.appData[0].payloadBytes;
        csv.write(`${d.devId},${pqd.seqNum},${d.lineNo},`
            + `${d.recvTime.valueOf()},${d.travelDelay},${d.procDelay}\n`);
    }
    csv.end();
}

const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 -i dev-id logfile')
    .help()
    .option('i', {
        alias: 'dev-id',
        type: 'number',
        nargs: 1,
        describe: 'device ID (serial number)',
        demandOption: true,
    })
    .alias('h', 'help')
    .alias('v', 'version')
    .version('0.2.0')
    .parse();

DataMsgType = await loadDataMsgType();
const events = await scanAppMgrLog(argv._[0], argv.devId);
fs.writeFile(`event-seq-${argv.devId}.json`, JSON.stringify(events, null, 2),
    err => {});
var { dataMsg, orphanPost } = amendRecvTimeForDataMsg(events);
dataMsg = calcDelays(dataMsg);
fs.writeFile(`data-msg-${argv.devId}.json`, JSON.stringify(dataMsg, null, 2),
    err => {});
writeTimingCsv(dataMsg, `data-timing-${argv.devId}.csv`);
