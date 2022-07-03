import { IAspect, TagManager } from "aws-cdk-lib";
import { IConstruct } from "constructs";

export class CdkAppTaggingAspect implements IAspect {
    constructor(private readonly cdkAppName: string) { }

    public visit(construct: IConstruct): void {
        if (!TagManager.isTaggable(construct))
            return;

        const node = construct.node;
        construct.tags.setTag("cdk-app", this.cdkAppName);
        construct.tags.setTag("cdk-stack", node.scopes[1].node.id);
        construct.tags.setTag("cdk-construct-id", node.id !== "Resource" ? node.id : node.scopes[node.scopes.length - 2].node.id);
        construct.tags.setTag("cdk-construct-path", node.path);
    }
}
