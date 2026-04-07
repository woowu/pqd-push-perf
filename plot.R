#!/usr/bin/env -S Rscript --vanilla
library(dplyr)
library(ggplot2)
library(forcats)
library(patchwork)

args <- unlist(commandArgs(trailingOnly=TRUE))
timezone <- args[2]
timing_data <- read.csv(args[1])
dev_id <- timing_data$DevId[1]
plot_cap <- paste(c('Device: ', dev_id), collapse='')

remove_duplicated <- function(d)
{
    d %>% arrange(RecvTime) %>% distinct(Seqno, .keep_all=TRUE)
}

plot_counts_bar <- function(ttl, repeated, ooo) {
    d <- data.frame(
            name=c('Total', 'Duplicated', 'Out-of-order'),
            value=c(ttl, repeated, ooo)
            )
    d$name <- factor(d$name, levels=c('Total', 'Duplicated', 'Out-of-order'))
    ggplot(d, aes(x=name, y=value)) +
        geom_bar(stat='identity') +
        geom_text(aes(label=value), vjust=-.1) +
        ylim(0, ttl*1.2) +
        labs(x='', y='', title='Received data points')
}

plot_seqno_vs_time <- function(d) {
    ggplot(d, aes(x=as.POSIXct(as.numeric(RecvTime/1000)
                        , tz=timezone), 
                        y=Seqno - min(Seqno))) +
        geom_point(shape=43) +
        labs(x='Time', y='Latest seqno',
            title='Data receiving')
}

plot_seqno_der <- function(d) {
    d$DiffSeqno <- c(diff(d$Seqno), 0)
    d$DiffTime <- c(diff(d$RecvTime), 0)
    d <- d %>% head(nrow(d) - 1)
    p <- ggplot(d, aes(x=as.POSIXct(as.numeric(RecvTime/1000)
                            , tz=timezone), 
                        y=DiffSeqno*1000/DiffTime)) +
        geom_point(shape=43) +
        labs(x='Time', y='Δseqno/second', title='Seqno change rate',
            subtitle='Sender (idea) rate: +1 seqno/second')
}

plot_travel_delay <- function(d) {
    ggplot(d, aes(x=as.POSIXct(as.numeric(RecvTime/1000)
                        , tz=timezone)
                    , y=TravelDelay/1000)) +
        geom_point(shape=43) +
        labs(x='Time', y='Seconds',
            title='Travel delay',
            subtitle='Receiver clock minus meter clock')
}

plot_proc_delay <- function(d) {
    ggplot(d, aes(x=as.POSIXct(as.numeric(RecvTime/1000)
                        , tz=timezone), 
                        y=ProcDelay/1000)) +
        geom_point(shape=43) +
        labs(x='Time', y='Seconds',
            title='Process delay',
            subtitle='Decryption + other server overhead')
}

# Duplications should have been removed from d
#
plot_period_histo <- function(d) {
    period <- diff(d$RecvTime)
    d <- d %>% tail(nrow(d) - 1)
    d$Period <- period/1000
    ggplot(d, aes(x=Period)) +
           geom_histogram(binwidth=1) +
           labs(x='Second',
                y='Nr. of data points',
                title='Data period')
}

plot_travel_delay_histo <- function(d) {
    ggplot(d, aes(x=TravelDelay/1000)) +
           geom_histogram(binwidth=.5) +
           labs(x='Second',
                y='Nr. of data points',
                title='Travel delay')
}

plot_proc_delay_histo <- function(d) {
    ggplot(d, aes(x=ProcDelay/1000)) +
           geom_histogram(binwidth=.05) +
           labs(x='Second',
                y='Nr. of data points',
                title='Process delay')
}

distinct <- remove_duplicated(timing_data)
repeats_count <- nrow(timing_data) - nrow(distinct)
ooo_count <- sum(diff(distinct$Seqno) < 0)

p_counts_bar <- plot_counts_bar(nrow(timing_data), repeats_count, ooo_count)
p_seqno_vs_time <- plot_seqno_vs_time(timing_data)
p_seqno_der <- plot_seqno_der(timing_data)
p_travel_delay <- plot_travel_delay(timing_data)
p_proc_delay <- plot_proc_delay(timing_data)
p_period_histo <- plot_period_histo(distinct)
p_travel_delay_histo <- plot_travel_delay_histo(distinct)
p_proc_delay_histo <- plot_proc_delay_histo(distinct)

p <- (p_counts_bar + p_proc_delay + p_proc_delay_histo) /
    (p_period_histo + p_travel_delay + p_travel_delay_histo) /
    (p_seqno_vs_time + p_seqno_der) +
    plot_annotation(title = 'PQD Push Observed On Receiver Side',
        subtitle = paste(c('Device: ', dev_id, '\n'), collapse=''))
ggsave(paste(c('pqd-perf-', dev_id, '.png'), collapse='')
       , p, width=10.5, height=7)
