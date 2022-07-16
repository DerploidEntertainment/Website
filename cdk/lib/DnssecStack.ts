import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';

export interface DnssecProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     * All new DNS records will be added to the hosted zone for this domain.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    domainName: string;

    /**
     * List of emails that will receive DNSSEC alarm notifications.
     */
    alarmSubscribeEmails: string[],
}

export class DnssecStack extends Stack {
    constructor(scope: Construct, id: string, props: DnssecProps) {
        super(scope, id, props);

        if (props.env?.region !== "us-east-1")
            throw new Error("DNSSEC resources must be deployed in the US East (N.Virginia) region. See https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-cmk-requirements.html");

        const kskMasterKey = new kms.Key(this, "KskMasterKey", {
            description: `Master key for DNSSEC signing for the ${props.domainName} and www.${props.domainName} domains`,
            enabled: true,
            enableKeyRotation: false,           // Key rotation not supported for asymmetric keys. See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-kms-key.html#cfn-kms-key-enablekeyrotation
            keySpec: kms.KeySpec.ECC_NIST_P256, // Asymmetric, 'ECC_NIST_P256' required for this key to be a DNSSEC key-signing key. See https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-cmk-requirements.html
            keyUsage: kms.KeyUsage.SIGN_VERIFY, // 'SIGN_VERIFY' required for ECC key material. See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-kms-key.html#cfn-kms-key-keyusage
            policy: new iam.PolicyDocument({    // Adapted from the default policy shown when enabling DNSSEC for a Hosted Zone in the Route 53 Console
                statements: [
                    new iam.PolicyStatement({
                        sid: "Allow root user to manage key",
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.AccountRootPrincipal()],
                        actions: ["kms:*"],
                        resources: ["*"],
                    }),
                    new iam.PolicyStatement({
                        sid: "Allow Route 53 DNSSEC service to work with key",
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.ServicePrincipal("dnssec-route53.amazonaws.com")],
                        actions: ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign"],
                        resources: ["*"],
                    }),
                    new iam.PolicyStatement({
                        sid: "Allow Route 53 DNSSEC service to create grants for key, as long as they're given to other AWS resources",
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.ServicePrincipal("dnssec-route53.amazonaws.com")],
                        actions: ["kms:CreateGrant"],
                        resources: ["*"],
                        conditions: {
                            Bool: {
                                "kms:GrantIsForAWSResource": true,
                            }
                        }
                    }),
                ]
            })
        });

        // alias/ prefix is required and periods aren't allowed (see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-kms-alias.html#cfn-kms-alias-aliasname)
        kskMasterKey.addAlias(`alias/dnssec/${props.domainName.replace(".", "-")}-ksk`)

        const hostedZone = route53.HostedZone.fromLookup(this, "DnssecHostedZone", { domainName: props.domainName });
        const ksk = new route53.CfnKeySigningKey(this, "KeySigningKey", {
            hostedZoneId: hostedZone.hostedZoneId,
            keyManagementServiceArn: kskMasterKey.keyArn,
            name: "key_signing_key",  // Cannot include hyphens. See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-route53-keysigningkey.html#cfn-route53-keysigningkey-name
            status: "ACTIVE"
        });

        const dnssec = new route53.CfnDNSSEC(this, "Dnssec", {
            hostedZoneId: hostedZone.hostedZoneId,
        });
        dnssec.addDependsOn(ksk);

        // Set up DNSSEC monitoring, as recommended here: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec.html
        const alarmTopic = new sns.Topic(this, "AlarmTopic");
        props.alarmSubscribeEmails.forEach(email => {
            alarmTopic.addSubscription(new snsSubs.EmailSubscription(email, { json: false }))    // Send message text, full notification JSON
        });
        [
            {
                name: "DNSSECInternalFailure",
                alarmDescription: "The DNSSECInternalFailure metric sets to 1, meaning an object in the hosted zone is in an INTERNAL_FAILURE state",
            },
            {
                name: "DNSSECKeySigningKeysNeedingAction",
                alarmDescription: "The DNSSECKeySigningKeysNeedingAction metric becomes >=1, meaning DNSSEC key signing keys are in an ACTION_NEEDED state (due to KMS failure).",
            },
        ].forEach(metric => {
            new cw.Metric({
                namespace: "AWS/Route53",
                metricName: metric.name,
                dimensionsMap: {
                    HostedZoneId: hostedZone.hostedZoneId,
                }
            }).createAlarm(this, "Alarm" + metric.name, {
                alarmDescription: metric.alarmDescription,
                comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                threshold: 1,
                evaluationPeriods: 1,
                actionsEnabled: true,
                // treatMissingData: Use CDK default (currently MISSING, in which "alarm does not consider missing data points when evaluating whether to change state")
            }).addAlarmAction(new cwActions.SnsAction(alarmTopic));
        });
    }
}
