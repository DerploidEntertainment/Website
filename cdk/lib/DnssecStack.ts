import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface DnssecProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     */
    domainName: string;

    /**
     *
     */
    hostedZoneId: string;
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
                        sid: "Enable root user to manage key",
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
        new kms.Alias(this, "KskAlias", {
            aliasName: `alias/dnssec/${props.domainName.replace(".", "-")}-ksk`, // alias/ prefix is required and periods aren't allowed (see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-kms-alias.html#cfn-kms-alias-aliasname)
            targetKey: kskMasterKey,
        });

        const ksk = new route53.CfnKeySigningKey(this, "KeySigningKey", {
            hostedZoneId: props.hostedZoneId,
            keyManagementServiceArn: kskMasterKey.keyArn,
            name: "key_signing_key",  // Cannot include hyphens. See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-route53-keysigningkey.html#cfn-route53-keysigningkey-name
            status: "ACTIVE"
        });

        const dnssec = new route53.CfnDNSSEC(this, "Dnssec", {
            hostedZoneId: props.hostedZoneId,
        });
        dnssec.addDependsOn(ksk);
    }
}
