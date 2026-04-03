#!/usr/bin/env -S Rscript --vanilla
library(dplyr)
library(ggplot2)
library(forcats)

args <- unlist(commandArgs(trailingOnly=TRUE))
timing_data <- read.csv(args[1])
dev_id <- timing_data$DevId[1]
plot_cap <- paste(c('Device: ', dev_id), collapse='')

plot_seqno <- function(d) {
    dd <- d;

    p <- ggplot(dd, aes(x=as.POSIXct(as.numeric(RecvTime/1000
                                                , origin='1970-01-01'
                                                , tz='GMT')), 
                        y=Seqno)) +
        geom_line() +
        labs(x='Time', y='Seqno',
            title='Seqno received vs time',
            caption=plot_cap)
    ggsave(paste(c('data-seqno-', dev_id, '.png'), collapse=''), p);

    dd$DiffSeqno <- c(0, diff(d$Seqno))
    dd <- dd %>% tail(nrow(dd) - 1)
    p <- ggplot(dd, aes(x=as.numeric(row.names(dd)) + 1, 
                        y=DiffSeqno)) +
        geom_line() +
        labs(x='', y='Seqno',
            title='Derivateive of Seqno of consecutively received data',
            caption=plot_cap)
    ggsave(paste(c('data-seqno-der-', dev_id, '.png'), collapse=''), p);
}

plot_proc_delay <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=ProcDelay/1000)) +
        geom_line() +
        labs(x='', y='Seconds',
            title='Receiver process delay',
            caption=plot_cap)
    ggsave(paste(c('proc-delay-', dev_id, '.png'), collapse=''), p);
}

plot_comm_delay <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=CommDelay/1000)) +
        geom_line() +
        labs(x='', y='Seconds',
            title='Communication delay',
            caption=plot_cap)
    ggsave(paste(c('comm-delay-', dev_id, '.png'), collapse=''), p);
}

plot_comm_delay_norm <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=(CommDelay - min(CommDelay))/1000)) +
        geom_line() +
        labs(x='', y='Seconds',
            title='Communication delay normalized',
            caption=plot_cap)
    ggsave(paste(c('comm-delay-norm-', dev_id, '.png'), collapse=''), p);
}

plot_seqno(timing_data);
plot_proc_delay(timing_data);
plot_comm_delay(timing_data);
plot_comm_delay_norm(timing_data);
