#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import hexdump from 'hexdump-nodejs';

function detectDatabotPostEvent(log)
{
    const databot_post_pat = 'Received SecureDatabotResource DoPost: Request ID:';
    var pos;
    var msg = log.msg;
    var ma;
    var reqId;
    var srcIp;
    var srcPort;
    var payload;
    var devId;
    var msgId;

    pos = msg.search(databot_post_pat);
    if (pos < 0) return null;

    msg = msg.slice(pos + databot_post_pat.length);
    reqId = parseInt(msg);
    const lines = msg.split('\n');
    if (lines.length < 3) {
        console.log('No enough log in post info:', msg);
        return null;
    }

    ma = lines[1].match(/Source: ([0-9.]+):([0-9]+)/);
    if (!ma) {
        console.error('Addr missed in post info:', lines[1]);
        return null;
    }
    srcIp = ma[1];
    srcPort = parseInt(ma[2]);

    pos = lines[2].search('AppOS Payload: ');
    if (pos < 0) {
        console.error('AppOS Payload missed in post info');
        return null;
    }
    payload = Buffer.from(
        lines[2].slice(pos + 'AppOS Payload '.length).trim(),
        'base64');
    if (payload[0] != 1) {
        console.error('Incorrect message verson in post info:', payload[0]);
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

function detectEvent(log)
{
    var e;

    if ((e = detectDatabotPostEvent(log))) {
        console.log(JSON.stringify(e, null, 2));
        return;
    }
}

async function onLog(log)
{
    console.log(log.lineNo + ':', log.timestamp, log.msg);
    detectEvent(log);
}

async function scanAppMgrLog(filename)
{
    const rl = createInterface({
        input: createReadStream(filename),
    });
    var lineNo = 0;
    var lineNoBegin;
    var partial = [];

    for await (const line of rl) {
        ++lineNo;
        if (!line.search(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}\s/)) {
            if (partial.length) {
                const parts = partial[0].split(/ - /);
                onLog({
                    lineNo: lineNoBegin,
                    timestamp: parts[0],
                    msg: [parts[11], ...partial.slice(1)].join('\n'),
                });
            }
            partial = [line];
            lineNoBegin = lineNo;
        } else
            partial.push(line);
    }
}

const argv = yargs(hideBin(process.argv)).parse();
await scanAppMgrLog(argv._[0]);
