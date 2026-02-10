import type { ToolSet } from 'ai';
import type { MCPClient } from '@ai-sdk/mcp';
import type { Tool } from '@ai-sdk/provider-utils';

// My manual replica
type MyToolSet = Record<string, (Tool<never, never> | Tool<any, any> | Tool<any, never> | Tool<never, any>) & Pick<Tool<any, any>, 'execute' | 'needsApproval' | 'onInputStart' | 'onInputDelta' | 'onInputAvailable'>>;

declare const client: MCPClient;

async function test() {
    const mcpTools = await client.tools();

    // Test A: real ToolSet from ai
    const a: ToolSet = mcpTools;

    // Test B: my manual ToolSet replica
    const b: MyToolSet = mcpTools;
}
