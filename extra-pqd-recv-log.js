#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import hexdump from 'hexdump-nodejs';
import protobuf from 'protobufjs';
import moment from 'moment';

var DataMsgType;

function decodeProtobuf(buf)
{
    return DataMsgType.decode(buf);
}

function detectDataBotPostEvent(log)
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
    const tmp = payload.slice(5, 9); 
    const ctrl = tmp[3];
    tmp[3] = 0;
    msgId = payload.readUint32BE(0) >> 8;
    return {
        lineNo: log.lineNo,
        timestamp: log.timestamp,
        type: 'p', // databot-post
        senderAddr: { ip: srcIp, port: srcPort },
        devId,
        encrypted: (ctrl & 1) == 0,
        singed: (ctrl & 2) != 0,
        hasHmac: (ctrl & 4) != 0,
        msgId,
        reqId,
    };
    return null;
}

function detectProcDataMsgAsync(log)
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
 
function detectDataMsgEvent(log)
{
    const dataMsgPat = 'DataBot_DataMsg.NodeID : ';
    var pos;
    var devId;
    var str;

    pos = log.msg.search(dataMsgPat);
    if (pos < 0) return null;

    const lines = log.msg.split('\n');
    devId = parseInt(lines[0].slice(pos + dataMsgPat.length), 16);
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
            type: 'd', // data-msg
            devId,
            msg,
        };
    } catch (e) {
        console.error('Invalid DataMsg:', log.msg);
    }
    return null;
}

function detectEvent(log)
{
    var e = null;

    (e = detectDataBotPostEvent(log))
        || (e = detectDataMsgEvent(log))
        || (e = detectProcDataMsgAsync(log))
    return e;
}

function loadDataMsgType()
{
    return new Promise((resolve, reject) => {
        protobuf.load('./meter-power-quality.json', (err, root) => {
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
                const timestamp = moment('2026-03-31 06:33:10,350'
                    , 'YYYY-MM-DD hh:mm:ss,SSS', true);
                const e = detectEvent({
                    lineNo: lineNoBegin,
                    timestamp,
                    msg: [parts[11], ...partial.slice(1)].join('\n').trim(),
                });
                if (e) {
                    //console.log(e);
                    if (e.type == '_procDataMsgAsync') {
                        reqId = e.reqId;
                    } else if (e.type == 'd') {
                        if (e.devId == devId) events.push({...e, reqId});
                        reqId = null;
                    } else if (e.devId == devId) {
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
        //if (e.type == 'p' && prev.type == 'p')
    }
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
    .parse();

DataMsgType = await loadDataMsgType();
const events = await scanAppMgrLog(argv._[0], argv.devId);
console.log(JSON.stringify(events, null, 2));
