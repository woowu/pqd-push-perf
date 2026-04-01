#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import hexdump from 'hexdump-nodejs';
import protobuf from 'protobufjs';

var DataMsgType;

function decodeProtobuf(buf)
{
    console.log(DataMsgType.decode(buf));
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
    msgId = payload.readUint32LE(0) >> 8;
    return {
        type: 'databot-post',
        senderAddr: { ip: srcIp, port: srcPort },
        devId,
        encrypted: (ctrl & 1) == 0,
        singed: (ctrl & 2) != 0,
        hasHmac: (ctrl & 4) != 0,
        msgId,
    };
    return null;
}

function detectDataMsgEvent(log)
{
    const dataMsgPat = 'DataBot_DataMsg.NodeID : ';
    var pos;
    var ma;
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
        const dataMsg = JSON.parse(str);
        return {
            type: 'data-msg',
            devId,
            msg: dataMsg,
        };
    } catch (e) {
        console.error('Invalid DataMsg:', str);
    }
    return null;
}

function detectEvent(state, log)
{
    var e;

    if ((e = detectDataBotPostEvent(log))
        || (e = detectDataMsgEvent(log))) {
        console.log(e);
        if (! state.lastEvent) {
            return { ...state, lastEvent: e };
        if (e.type == 'data-post' && state.lastEvent.type != 'data-msg') {
            console.error('Event order mismatched, possibly a databot post is not processed');
            console.log(log);
            return state;
        }
        if (e.type == 'data-msg') {
            const dataMsg = decodeProtobuf(Buffer.from(
                e.msg.dataTransport.appData[0].payloadBytes, 'base64'));
        }
    }
    return state;
}

async function onLog(state, log)
{
    console.log(log.lineNo + ':', log.timestamp, log.msg);
    return detectEvent(state, log);
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

async function scanAppMgrLog(filename)
{
    const rl = createInterface({
        input: createReadStream(filename),
    });
    var lineNo = 0;
    var lineNoBegin;
    var partial = [];
    var state = {};

    for await (const line of rl) {
        ++lineNo;
        if (!line.search(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}\s/)) {
            if (partial.length) {
                const parts = partial[0].split(/ - /);
                state = onLog(state, {
                    lineNo: lineNoBegin,
                    timestamp: parts[0],
                    msg: [parts[11], ...partial.slice(1)].join('\n').trim(),
                });
            }
            partial = [line];
            lineNoBegin = lineNo;
        } else
            partial.push(line);
    }
}

DataMsgType = await loadDataMsgType();
const argv = yargs(hideBin(process.argv)).parse();
await scanAppMgrLog(argv._[0]);
