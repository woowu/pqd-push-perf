#!/usr/bin/env node --harmony

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function onLog(log)
{
    console.log(log.lineNo, log.timestamp, log.msg);
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
