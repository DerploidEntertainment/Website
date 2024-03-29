import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as util from './util';

export interface HealthCheckAlarmStackProps extends StackProps {
    /**
     * The domain at which the website is hosted. Must be an apex domain, e.g., "example.com" not "www.example.com".
     * Route53 health check alarms will be set up for this domains and its www subdomain.
     */
    mainApexDomain: string;

    /**
     * The domains that redirect to {@link mainApexDomain}. Must be apex domains, e.g., "example.com" or "www.example.com".
     * Route53 health check alarms will be set up for these domains and their www subdomains.
     */
    redirectApexDomains: string[];

    /**
     * How often, in seconds, the main website domain will be sent health check requests.
     */
    mainDomainRequestIntervalSeconds?: number | undefined,

    /**
     * How often, in seconds, the redirect domains will be sent health check requests.
     * Should be as high as Route53 Health Checks will allow, since we don't need frequent checks for redirect domains.
     */
    redirectDomainRequestIntervalSeconds?: number | undefined,

    /**
     * Health check status metric for main domain will use this period.
     * Should be pretty short (e.g., 1 min) so that you know if the website is unhealthy quickly.
     * Default is 1 minute.
     */
    mainDomainHealthCheckStatusMetricPeriod?: Duration | undefined,

    /**
     * Health check status metric for redirect domains will use this period.
     * Need not be as short as {@link mainDomainHealthCheckStatusMetricPeriod}, since redirect domains being unhealthy is less of an issue.
     * Default is 5 minutes.
     */
    redirectDomainsHealthCheckStatusMetricPeriod?: Duration | undefined,

    /**
     * List of emails that will receive health check alarm notifications.
     */
    healthCheckAlarmSubscribeEmails: string[],
}

export class HealthCheckAlarmStack extends Stack {

    constructor(scope: Construct, id: string, props: HealthCheckAlarmStackProps) {
        super(scope, id, props);

        if (props.env?.region !== "us-east-1")
            throw new Error("Route53 metrics are only available in US East (N.Virginia). See https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/monitoring-health-checks.html#monitoring-metrics-in-cloudwatch-console-procedure");

        // Set up SNS topic to notify of alarms
        const healthCheckAlarmTopic = new sns.Topic(this, "HealthCheckAlarmTopic");
        props.healthCheckAlarmSubscribeEmails.forEach(email => {
            healthCheckAlarmTopic.addSubscription(new snsSubs.EmailSubscription(email, { json: false }))    // Send message text, not full notification JSON
        });
        const snsAlarmAction = new cwActions.SnsAction(healthCheckAlarmTopic);

        // The Derploid site is completely static, so the only latency in requests is caused by Route 53 DNS lookup and GitHub Pages download speeds.
        // We have no control over either of these factors, making their alarms completely unactionable, and thus an unnecessary expense.
        // We could potentially have client-side performance alarms for if/when our JS files get more complex,
        // but that would probably be tracked by a different system than Route53 HealthChecks.
        const measureLatency = false;

        // Set up Route53 health checks and status alarms for the "main" and "main redirect" domains.
        // Both domains should be fast, as both are pretty equally likely to be typed into browsers by users.
        const mainDomainPascalCase = util.domainToPascalCase(props.mainApexDomain);
        const wwwMainDomainPascalCase = `Www${mainDomainPascalCase}`;
        const mainRedirectHealthCheck = new route53.CfnHealthCheck(this, `${mainDomainPascalCase}HealthCheck`, {
            healthCheckConfig: {
                fullyQualifiedDomainName: props.mainApexDomain,
                type: "HTTP",   // We only need to validate TLS connectivity and response content on the main website domain
                requestInterval: props.redirectDomainRequestIntervalSeconds,
                // failureThreshold: // Use Route53 default (currently 3)
                measureLatency,
            }
        });
        const mainRedirectStatusAlarm = this.getHealthCheckStatusAlarm(mainRedirectHealthCheck, mainDomainPascalCase, props.redirectDomainsHealthCheckStatusMetricPeriod);

        const mainHealthCheck = new route53.CfnHealthCheck(this, `${wwwMainDomainPascalCase}HealthCheck`, {
            healthCheckConfig: {
                fullyQualifiedDomainName: `www.${props.mainApexDomain}`,
                type: "HTTPS_STR_MATCH",
                enableSni: true,
                // Search string can't be a regex and must be in first 5120 bytes, so just verify home page title.
                // This verifies that we didn't get an error page, and that the Jekyll builds worked correctly.
                searchString: "Derploid Entertainment | Home",
                requestInterval: props.mainDomainRequestIntervalSeconds,
                measureLatency,
                // failureThreshold: // Use Route53 default (currently 3)
            },
        });
        const mainStatusAlarm = this.getHealthCheckStatusAlarm(mainHealthCheck, wwwMainDomainPascalCase, props.mainDomainHealthCheckStatusMetricPeriod ?? Duration.minutes(1), true);

        // Set up Route53 health checks and status alarms for "redirect" domains
        const redirectAlarms: cw.Alarm[] = props.redirectApexDomains.flatMap(apex => {
            const apexPascalCase = util.domainToPascalCase(apex);
            return [
                { fqdn: apex, resourcePrefix: apexPascalCase, },
                { fqdn: `www.${apex}`, resourcePrefix: `Www${apexPascalCase}`, },
            ].map(subDomain => {
                const healthCheck = new route53.CfnHealthCheck(this, `${subDomain.resourcePrefix}HealthCheck`, {
                    healthCheckConfig: {
                        type: "HTTP",           // We'll validate TLS connectivity and response content on the main website domain
                        fullyQualifiedDomainName: subDomain.fqdn,
                        measureLatency: false,  // We don't need this for redirect domains. Who really cares if these domains are slow?
                        requestInterval: props.redirectDomainRequestIntervalSeconds,
                        // failureThreshold: // Use Route53 default (currently 3)
                    },
                });
                return this.getHealthCheckStatusAlarm(healthCheck, subDomain.resourcePrefix, props.redirectDomainsHealthCheckStatusMetricPeriod);
            });
        });


        // Alarm when main domain is unhealthy but other domains are still good due to caching.
        // This will alert us to act before all domains are unhealthy.
        mainStatusAlarm.addAlarmAction(snsAlarmAction);

        const allRedirectStatusAlarms = [mainRedirectStatusAlarm].concat(redirectAlarms);

        // Reduce alarm noise when the main website goes down.
        // I.e., when the redirect domain caches expire and they turn unhealthy too, we won't get a new alarm for each domain.
        new cw.CompositeAlarm(this, "AlarmUnhealthyWebsiteBreakingRedirects", {
            alarmDescription: "Main website and zero or more redirect domains are unhealthy",
            alarmRule: cw.AlarmRule.allOf(mainStatusAlarm, cw.AlarmRule.anyOf(...allRedirectStatusAlarms)), // AND(main, OR(redirects))
            actionsEnabled: true,
            // treatMissingData: Use CDK default (currently MISSING, in which "alarm does not consider missing data points when evaluating whether to change state")
        }).addAlarmAction(snsAlarmAction);

        // Ensure same topic is notified by same alarm anytime a redirect domain becomes unhealthy.
        // Will alarm around same time as AlarmUnhealthyWebsiteBreakingRedirects if the main site is unhealthy.
        new cw.CompositeAlarm(this, "AlarmRedirectDomainUnhealthy", {
            alarmDescription: "One or more redirect domains are unhealthy",
            alarmRule: cw.AlarmRule.anyOf(...allRedirectStatusAlarms), // OR(redirects)
            actionsEnabled: true,
            // treatMissingData: Use CDK default (currently MISSING, in which "alarm does not consider missing data points when evaluating whether to change state")
        }).addAlarmAction(snsAlarmAction);
    }

    private getHealthCheckStatusAlarm(healthCheck: route53.CfnHealthCheck, alarmNamePrefix: string, metricPeriod?: Duration, actionsEnabled: boolean = false) {
        return new cw.Metric({
            namespace: "AWS/Route53",
            metricName: "HealthCheckStatus",
            dimensionsMap: {
                HealthCheckId: healthCheck.attrHealthCheckId,
            },
            statistic: "Minimum",
            period: metricPeriod,    // CDK default is 5 min
        }).createAlarm(this, `${alarmNamePrefix}AlarmHealthCheckStatus`, {
            alarmDescription: "GitHub Pages website is unhealthy",
            comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 1,   // Route53 health checks already have a failure threshold of several data points, so alarm immediately here
            actionsEnabled: actionsEnabled,
            // treatMissingData: Use CDK default (currently MISSING, in which "alarm does not consider missing data points when evaluating whether to change state")
        });
    }
}
