#!/usr/bin/env -S Rscript --vanilla
library(dplyr)
library(ggplot2)
library(forcats)

plot_seqno <- function(d) {
    dd <- d;
    dd$DiffSeqno <- c(0, diff(d$Seqno))
    dd <- dd %>% tail(nrow(dd) - 1)
    p <- ggplot(dd, aes(x=as.numeric(row.names(dd)) + 1, 
                        y=DiffSeqno)) +
        geom_line() +
        labs(x='', y='Derivative of Seqno of consecutively received data')
    ggsave('data-seqno.png', p);
}

plot_proc_delay <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=ProcDelay/1000)) +
        geom_line() +
        labs(x='', y='Receiver process delay (Sec)')
    ggsave('proc-delay.png', p);
}

plot_comm_delay <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=CommDelay/1000)) +
        geom_line() +
        labs(x='', y='Communication delay (Sec)')
    ggsave('comm-delay.png', p);
}

plot_comm_delay_norm <- function(d) {
    p <- ggplot(d, aes(x=as.numeric(row.names(d)), 
                        y=(CommDelay - min(CommDelay))/1000)) +
        geom_line() +
        labs(x='', y='Communication delay w/ clock difference eliminated (Sec)')
    ggsave('comm-delay-norm.png', p);
}

args <- unlist(commandArgs(trailingOnly=TRUE))
timing_data <- read.csv(args[1])
plot_seqno(timing_data);
plot_proc_delay(timing_data);
plot_comm_delay_norm(timing_data);
