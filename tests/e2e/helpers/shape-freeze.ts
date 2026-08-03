import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveContractPath } from './paths.js';

/**
 * Primitive JSON shape node.
 */
export interface JsonPrimitiveShape {
    /**
     * Primitive node kind.
     */
    kind: 'string' | 'number' | 'boolean' | 'null';
}

/**
 * Array JSON shape node.
 */
export interface JsonArrayShape {
    /**
     * Node kind marker.
     */
    kind: 'array';
    /**
     * Ordered shape nodes for each array element.
     */
    items: JsonShapeNode[];
}

/**
 * Object JSON shape node.
 */
export interface JsonObjectShape {
    /**
     * Node kind marker.
     */
    kind: 'object';
    /**
     * Exact object property map keyed by property name.
     */
    properties: Record<string, JsonShapeNode>;
}

/**
 * Recursive JSON shape node used for contract freezing.
 */
export type JsonShapeNode =
    | JsonPrimitiveShape
    | JsonArrayShape
    | JsonObjectShape;

/**
 * Arguments for frozen-contract assertions.
 */
export interface FrozenShapeAssertion {
    /**
     * File name within `tests/e2e/contracts`.
     */
    contractFileName: string;
    /**
     * Runtime payload to validate against the frozen contract shape.
     */
    payload: unknown;
}

/**
 * Converts a JSON payload into a deterministic shape tree.
 *
 * @param payload - Runtime JSON payload.
 * @returns Deterministic shape tree preserving object keys and array layout.
 */
export function extractJsonShape(payload: unknown): JsonShapeNode {
    if (payload === null) {
        return { kind: 'null' };
    }

    const payloadType = typeof payload;
    if (payloadType === 'string') {
        return { kind: 'string' };
    }
    if (payloadType === 'number') {
        return { kind: 'number' };
    }
    if (payloadType === 'boolean') {
        return { kind: 'boolean' };
    }

    if (Array.isArray(payload)) {
        return {
            kind: 'array',
            items: payload.map((item) => extractJsonShape(item)),
        };
    }

    if (payloadType === 'object') {
        const entries = Object.entries(payload as Record<string, unknown>).sort(
            ([left], [right]) => left.localeCompare(right),
        );
        const properties: Record<string, JsonShapeNode> = {};
        for (const [key, value] of entries) {
            properties[key] = extractJsonShape(value);
        }
        return {
            kind: 'object',
            properties,
        };
    }

    throw new Error(`Unsupported JSON payload value type: ${payloadType}`);
}

/**
 * Indicates whether shape updates are enabled for regeneration flows.
 *
 * @returns `true` when contract files should be rewritten from runtime shapes.
 */
function shouldUpdateContractShapes(): boolean {
    const raw = process.env.UPDATE_CONTRACT_SHAPES;
    return raw === '1' || raw === 'true';
}

/**
 * Loads an existing contract shape file from disk.
 *
 * @param contractPath - Absolute contract file path.
 * @returns Parsed shape tree.
 */
async function readContractShape(contractPath: string): Promise<JsonShapeNode> {
    const fileContent = await readFile(contractPath, 'utf-8');
    return JSON.parse(fileContent) as JsonShapeNode;
}

/**
 * Writes a contract shape file to disk.
 *
 * @param contractPath - Absolute contract file path.
 * @param shape - Shape tree to persist.
 */
async function writeContractShape(
    contractPath: string,
    shape: JsonShapeNode,
): Promise<void> {
    await mkdir(path.dirname(contractPath), { recursive: true });
    await writeFile(
        contractPath,
        `${JSON.stringify(shape, null, 2)}\n`,
        'utf-8',
    );
}

/**
 * Asserts a payload matches the exact frozen shape for a contract file.
 *
 * Set `UPDATE_CONTRACT_SHAPES=1` to regenerate the shape file.
 *
 * @param assertion - Assertion parameters.
 */
export async function assertFrozenShape(
    assertion: FrozenShapeAssertion,
): Promise<void> {
    const contractPath = resolveContractPath(assertion.contractFileName);
    const actualShape = extractJsonShape(assertion.payload);

    if (shouldUpdateContractShapes()) {
        await writeContractShape(contractPath, actualShape);
        return;
    }

    const expectedShape = await readContractShape(contractPath);
    assert.deepStrictEqual(
        actualShape,
        expectedShape,
        `Contract shape mismatch for ${assertion.contractFileName}`,
    );
}
