#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Duration, Environment } from 'aws-cdk-lib';
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

// Set according to AWS CLI profile passed to CDK CLI (see https://docs.aws.amazon.com/cdk/v2/guide/environments.html)
const cdkEnv: Environment = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
}
const usEast1Env: Environment = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",    // Some resources require this region
}

// Set up DNS records for GitHub Pages website on main domain with DNSSEC
const mainDomainPascalCase = env.mainRootDomain[0].toUpperCase() + env.mainRootDomain.substring(1);
const mainTldPascalCase = env.mainTLD[0].toUpperCase() + env.mainTLD.substring(1);
const githubPagesOrganizationWebsiteStack = new GithubPagesOrganizationWebsiteStack(app, `${mainDomainPascalCase}GithubPagesOrganizationWebsiteStack`, {
    env: cdkEnv,
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
new DnssecStack(app, `${mainDomainPascalCase}${mainTldPascalCase}DnssecStack`, {
    env: usEast1Env,
    description: "DNSSEC settings for the organization website",
    domainName: `${env.mainRootDomain}.${env.mainTLD}`,
    hostedZoneId: env.mainHostedZoneId,
});

// Set up DNS records to redirect provided domains to the "main" domain, with DNSSEC
const redirectHostedZoneIds: string[] = env.redirectHostedZoneIds.split(",");
env.redirectTLDs
    .split(",")
    .forEach((tld, index) => {
        const tldPascalCase = tld[0].toUpperCase() + tld.substring(1);
        new WebsiteRedirectStack(app, `${mainDomainPascalCase}${tldPascalCase}WebsiteRedirectStack`, {
            env: cdkEnv,
            description: `Resources for redirecting the .${tld} domain to the organization website`,
            redirectApexDomain: `${env.mainRootDomain}.${tld}`,
            siteDomain: `${env.mainRootDomain}.${env.mainTLD}`,
            hostedZoneId: redirectHostedZoneIds[index],
            logBucket: githubPagesOrganizationWebsiteStack.logBucket,
        });

        new DnssecStack(app, `${mainDomainPascalCase}${tldPascalCase}DnssecStack`, {
            env: usEast1Env,
            description: `DNSSEC settings for the website .${tld} domain`,
            domainName: `${env.mainRootDomain}.${tld}`,
            hostedZoneId: redirectHostedZoneIds[index],
        });
    });
