#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';

import * as sharedEnv from "../env/env.shared.json";
import * as testEnv from "../env/env.test.json";
import * as testSecretEnv from "../env/env.test.secret.json";
import * as prodEnv from "../env/env.prod.json";
import * as prodSecretEnv from "../env/env.prod.secret.json";

const app = new cdk.App();

const envName: string = process.env.NODE_ENV ?? "test";
const env = envName === "test"
    ? {
        ...sharedEnv,
        ...testEnv,
        ...testSecretEnv,
    }
    : {
        ...sharedEnv,
        ...prodEnv,
        ...prodSecretEnv,
    };

env.mainRootDomain = env.mainRootDomain.toLowerCase();
env.mainTLD = env.mainTLD.toLowerCase();
env.redirectTLDs = env.redirectTLDs.split(",").map(x => x.toLowerCase()).join(",");


// Set up DNS records for GitHub Pages website on main domain with DNSSEC
const githubPagesOrganizationWebsiteStack = new GithubPagesOrganizationWebsiteStack(app, 'GithubPagesOrganizationWebsiteStack', {
    description: "Resources and DNS settings for hosting the organization website with GitHub Pages",
    apexDomainName: `${env.mainRootDomain}.${env.mainTLD}`,
    hostedZoneId: env.mainHostedZoneId,
    logBucketExpiration: env.logBucketExpirationDays ? Duration.days(env.logBucketExpirationDays) : undefined,
    githubPagesDefaultDomain: env.githubPagesDefaultDomain,
    githubPagesDnsVerificationChallenge: {
        domain: env.githubPagesDnsVerificationDomain,
        txtValue: env.githubPagesDnsVerificationTxtValue,
    },
    githubOrganizationDnsVerificationChallenge: {
        domain: env.githubOrgDnsVerificationDomain,
        txtValue: env.githubOrgDnsVerificationTxtValue,
    },
});
new DnssecStack(app, 'MainDnssecStack', {
    description: "DNSSEC settings for the organization website",
    domainName: `${env.mainRootDomain}.${env.mainTLD}`,
    hostedZoneId: env.mainHostedZoneId,
});

// Set up DNS records to redirect provided domains to the "main" domain, with DNSSEC
const redirectHostedZoneIds: string[] = env.redirectHostedZoneIds.split(",");
env.redirectTLDs
    .split(",")
    .forEach((tld, index) => {
        new WebsiteRedirectStack(app, `${tld}WebsiteRedirectStack`, {
            description: `Resources for redirecting the ${tld} domain to the organization website`,
            redirectApexDomain: `${rootDomain}.${tld}`,
            redirectApexDomain: `${env.mainRootDomain}.${tld}`,
            siteDomain: `${env.mainRootDomain}.${env.mainTLD}`,
            hostedZoneId: redirectHostedZoneIds[index],
            logBucket: githubPagesOrganizationWebsiteStack.logBucket,
        });

        new DnssecStack(app, `${tld}DnssecStack`, {
            description: `DNSSEC settings for the website ${tld} domain`,
            domainName: `${env.mainRootDomain}.${tld}`,
            hostedZoneId: redirectHostedZoneIds[index],
        });
    });