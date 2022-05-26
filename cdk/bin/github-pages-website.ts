#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';

const app = new cdk.App();

const rootDomain: string = app.node.tryGetContext('mainRootDomain');
const mainTLD: string = app.node.tryGetContext('mainTLD');
const mainHostedZoneId: string = app.node.tryGetContext('mainHostedZoneId');
const redirectTLDs: string = app.node.tryGetContext('redirectTLDs');
const contextRedirectHostedZoneIds: string = app.node.tryGetContext('redirectHostedZoneIds');
const logBucketExpirationDays: number | undefined = app.node.tryGetContext('logBucketExpirationDays');
const githubPagesDefaultDomain: string = app.node.tryGetContext('githubPagesDefaultDomain');
const githubPagesDnsVerificationDomain: string = app.node.tryGetContext('githubPagesDnsVerificationDomain');
const githubPagesDnsVerificationTxtValue: string = app.node.tryGetContext('githubPagesDnsVerificationTxtValue');
const githubOrgDnsVerificationDomain: string = app.node.tryGetContext('githubOrgDnsVerificationDomain');
const githubOrgDnsVerificationTxtValue: string = app.node.tryGetContext('githubOrgDnsVerificationTxtValue');

// Set up DNS records for GitHub Pages website on main domain with DNSSEC
const githubPagesOrganizationWebsiteStack = new GithubPagesOrganizationWebsiteStack(app, 'GithubPagesOrganizationWebsiteStack', {
    description: "Resources and DNS settings for hosting the organization website with GitHub Pages",
    apexDomainName: `${rootDomain}.${rootDomain}`,
    hostedZoneId: mainHostedZoneId,
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
new DnssecStack(app, 'MainDnssecStack', {
    description: "DNSSEC settings for the organization website",
    domainName: `${rootDomain}.${mainTLD}`,
    hostedZoneId: mainHostedZoneId,
});

// Set up DNS records to redirect provided domains to the "main" domain, with DNSSEC
const redirectHostedZoneIds: string[] = contextRedirectHostedZoneIds.split(",");
redirectTLDs
    .split(",")
    .forEach((tld, index) => {
        new WebsiteRedirectStack(app, `${tld}WebsiteRedirectStack`, {
            description: `Resources for redirecting the ${tld} domain to the organization website`,
            redirectApexDomain: `${rootDomain}.${tld}`,
            siteDomain: `${rootDomain}.${mainTLD}`,
            hostedZoneId: redirectHostedZoneIds[index],
            logBucket: githubPagesOrganizationWebsiteStack.logBucket,
        });

        new DnssecStack(app, `${tld}DnssecStack`, {
            description: `DNSSEC settings for the website ${tld} domain`,
            domainName: `${rootDomain}.${tld}`,
            hostedZoneId: redirectHostedZoneIds[index],
        });
    });