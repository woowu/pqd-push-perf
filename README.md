# Extrace AppManager logfile for Power Quality Data push

## Install

```
$ npm i
```

## Usage

### Create a data-set directory and cd into it.
```
$ mkdir mydata-01
$ cd mydata-01
  ```

### Extract info from the logfile
```
Usage: extra-pqd-recv-log.js -i dev-id logfile

Options:
    --version   Show version number                                  [boolean]
-i, --dev-id    device ID (serial number)                  [number] [required]
-z, --timezone  timezone of time in log file, e.g., +1100  [string] [required]
-h, --help      Show help                                            [boolean]
```
Example:
```
$ ../extra-pdq-recv-log.js -i 1373892682 -z +1100 ../data/appmgr.log
```

Two JSON and one csv reports will be generated

- event-seq-<dev-id>.json: Time sequence of data-post and data-msg-processed
  events extracted from the logfile for the giving device.
- data-msg-<dev-id>.json: List of all the processed data point, i.e., AppOS
  message has been decrypted by Power Manger and the embedded Power
  Quality Data (PQD) has been decoded by this tool.
- data-timing-<dev-id>.json: Timing data for the received data points, which
  will be used for plotting in the next step.

### Plot

```
$ ../plot.R data-timing-1373892682.csv
```

Four plots (png files) will be generated:

- data-seqno-<dev-id>.png: Received PQD seqno over time. This is a way to
  view the communcation halting and data losting.
- data-seqno-der-<dev-id>.png: Derivative of seqno of all the processed data
  points.  This is another way to detect data lost.  When push period is 5
  second, the seqno difference should be 5 in normal case without lossing.
- comm-delay-<dev-id>.png: Communication delays calculatedc by substracting the
  time a data point was sent from the meter from the time it was received by the
  receiver. This delay unfortunately also encodes the clock difference between
  the sender and the receiver because we currently don't add sender time in the
  PQD.
- comm-delay-norm-<dev-id>.png: Similar to the above expect that the delay times
  were substracted with the minimum delay time found in the data set. This can
  elimites the clock difference mentioned above but it also elimilates the fixed
  delay component in the communication channel.
- proc-delay-<dev-id>.png: This is delay times of receiver spending for decrypting
  and processing the received raw data.
