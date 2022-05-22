#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';

const app = new cdk.App();

const rootDomain: string = app.node.tryGetContext('rootDomain');
const comHostedZoneId: string = app.node.tryGetContext('comHostedZoneId');
const netHostedZoneId: string = app.node.tryGetContext('netHostedZoneId');
const orgHostedZoneId: string = app.node.tryGetContext('orgHostedZoneId');
const logBucketExpirationDays: number | undefined = app.node.tryGetContext('logBucketExpirationDays');
const githubPagesDefaultDomain: string = app.node.tryGetContext('githubPagesDefaultDomain');
const githubPagesDnsVerificationDomain: string = app.node.tryGetContext('githubPagesDnsVerificationDomain');
const githubPagesDnsVerificationTxtValue: string = app.node.tryGetContext('githubPagesDnsVerificationTxtValue');
const githubOrgDnsVerificationDomain: string = app.node.tryGetContext('githubOrgDnsVerificationDomain');
const githubOrgDnsVerificationTxtValue: string = app.node.tryGetContext('githubOrgDnsVerificationTxtValue');

// Set up DNS records for GitHub Pages website on .com domain with DNSSEC
const githubPagesOrganizationWebsiteStack = new GithubPagesOrganizationWebsiteStack(app, 'GithubPagesOrganizationWebsiteStack', {
    description: "Resources and DNS settings for hosting the organization website with GitHub Pages",
    apexDomainName: `${rootDomain}.com`,
    hostedZoneId: comHostedZoneId,
    logBucketExpiration: logBucketExpirationDays ? Duration.days(logBucketExpirationDays) : undefined,
    githubPagesDefaultDomain: githubPagesDefaultDomain,
    githubPagesDnsVerificationChallenge: {
        domain: githubPagesDnsVerificationDomain,
        txtValue: githubPagesDnsVerificationTxtValue,
    },
    githubOrganizationDnsVerificationChallenge: {
        domain: githubOrgDnsVerificationDomain,
        txtValue: githubOrgDnsVerificationTxtValue,
    },
});
new DnssecStack(app, 'ComDnssecStack', {
    description: "DNSSEC settings for the organization website",
    domainName: `${rootDomain}.com`,
    hostedZoneId: comHostedZoneId,
});

// Set up DNS records to redirect .net domain to main domain, with DNSSEC
new WebsiteRedirectStack(app, 'NetWebsiteRedirectStack', {
    description: "Resources for redirecting the .net domain to the organization website",
    redirectApexDomain: `${rootDomain}.net`,
    siteDomain: `${rootDomain}.com`,
    hostedZoneId: netHostedZoneId,
    logBucket: githubPagesOrganizationWebsiteStack.logBucket,
});
new DnssecStack(app, 'NetDnssecStack', {
    description: "DNSSEC settings for the website .net domain",
    domainName: `${rootDomain}.net`,
    hostedZoneId: netHostedZoneId,
});

// Set up DNS records to redirect .org domain to main domain, with DNSSEC
new WebsiteRedirectStack(app, 'OrgWebsiteRedirectStack', {
    description: "Resources for redirecting the .org domain to the organization website",
    redirectApexDomain: `${rootDomain}.org`,
    siteDomain: `${rootDomain}.com`,
    hostedZoneId: orgHostedZoneId,
    logBucket: githubPagesOrganizationWebsiteStack.logBucket,
});
new DnssecStack(app, 'OrgDnssecStack', {
    description: "DNSSEC settings for the website .org domain",
    domainName: `${rootDomain}.org`,
    hostedZoneId: orgHostedZoneId,
});