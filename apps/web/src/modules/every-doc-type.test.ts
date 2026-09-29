/**
 * The guard for PLAN H2: every document type the server registers can be filled in from a screen. A type either has its own
 * form in screens.ts, or the general form (generic/DocForm) can fill every required field of its input. A new document
 * type with no usable screen fails here, by name, so it is found before the shop is.
 */
import { describe, expect, it } from 'vitest';
import { createTestEnv } from '../../../server/test/helpers.ts';
import type { DocTypeInfo, JsonSchema } from '../api.ts';
import { fieldsOf } from '../generic/fields.ts';
import { FORMS, VIEWS } from './screens.ts';

/**
 * Types that have no usable screen YET, each with the reason. The test fails if a name stays here after its form exists,
 * so this list only shrinks.
 */
const EXPECTED_MISSING: Record<string, string> = {
  'jo.dp_invoice': 'the downpayment invoice (downpayment VAT mode C) picks its job order by id: it needs its own form',
};

/**
 * What the general form cannot fill: a list or group (`unsupported`), or a reference to another document by its id, which
 * a person cannot type (format uuid). The general form's own field kinds are decided by fieldsOf, the code it draws with.
 */
function unfillable(schema: JsonSchema): string[] {
  const kinds = new Map(fieldsOf(schema).map((f) => [f.name, f.kind]));
  return (schema.required ?? []).filter((name) => kinds.get(name) === 'unsupported' || schema.properties?.[name]?.format === 'uuid' || !kinds.has(name));
}

const missingScreens = (types: DocTypeInfo[]) =>
  types.filter((t) => !FORMS[t.key] && unfillable(t.inputJsonSchema).length > 0).map((t) => t.key).sort();

describe('every document type has a usable screen', () => {
  it('names only the documents still waiting for their screen', async () => {
    const env = await createTestEnv();
    const owner = await env.as('owner');
    // The list GET /api/doc-types gives: the types the user may view, with the JSON schema of the input.
    const types = (await owner.get('/api/doc-types')).json() as DocTypeInfo[];
    expect(types.map((t) => t.key).sort(), 'the owner sees every registered type').toEqual(env.deps.registry.docTypes().map((d) => d.key).sort());
    expect(types.length).toBeGreaterThan(40);
    expect(missingScreens(types), 'a type has no form: give it one in screens.ts, or make its input fillable by the general form').toEqual(Object.keys(EXPECTED_MISSING).sort());
  });

  it('a type with a form needs nothing else; a type without one is judged by its required fields', () => {
    const type = (key: string, schema: JsonSchema): DocTypeInfo => ({ key, module: 'X', title: key, dating: 'system', canCreate: true, canPost: true, canCancel: true, inputJsonSchema: schema });
    const simple: JsonSchema = { type: 'object', properties: { note: { type: 'string' }, amountCents: { type: 'integer' } }, required: ['note', 'amountCents'] };
    const list: JsonSchema = { type: 'object', properties: { lines: { type: 'array' } }, required: ['lines'] };
    const reference: JsonSchema = { type: 'object', properties: { releaseId: { type: 'string', format: 'uuid' } }, required: ['releaseId'] };
    const optionalList: JsonSchema = { type: 'object', properties: { note: { type: 'string' }, lines: { type: 'array' } }, required: ['note'] };
    expect(missingScreens([type('x.simple', simple), type('x.optional_list', optionalList)])).toEqual([]);
    expect(missingScreens([type('x.list', list), type('x.reference', reference)])).toEqual(['x.list', 'x.reference']);
    expect(missingScreens([type('cash.count', list)])).toEqual([]); // cash.count has a registered form
  });

  it('every form and view in screens.ts belongs to a document type the server registers', async () => {
    const env = await createTestEnv();
    const known = new Set(env.deps.registry.docTypes().map((d) => d.key));
    expect([...Object.keys(FORMS), ...Object.keys(VIEWS)].filter((key) => !known.has(key))).toEqual([]);
  });
});
