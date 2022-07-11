import { IAspect, Stack, TagManager } from "aws-cdk-lib";
import { IConstruct } from "constructs";

export class CdkAppTaggingAspect implements IAspect {

    constructor(private readonly cdkAppName: string) { }

    public visit(construct: IConstruct): void {
        if (!TagManager.isTaggable(construct))
            return;

        const node = construct.node;
        construct.tags.setTag("cdk-app", this.cdkAppName);
        construct.tags.setTag("cdk-construct-id", node.id !== "Resource" ? node.id : node.scopes[node.scopes.length - 2].node.id);
        construct.tags.setTag("cdk-construct-path", node.path);

        // Loop through all parent scopes, as there's no guarantee which one will be the Stack.
        // Construct's "closest" Stack might be nested in another, so keep the closest, most informative Stack ID in the tag.
        let stackId: string | undefined;
        for (let scope = construct.node.scope; scope !== undefined; scope = scope.node.scope) {
            if (!stackId && Stack.isStack(scope)) {
                stackId = scope.node.id;
                construct.tags.setTag("cdk-stack", stackId);
            }
        }
    }
}
