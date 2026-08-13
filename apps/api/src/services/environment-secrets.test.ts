import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeEnvironmentSecret,
  encodeEnvironmentSecret,
  getEnvironmentSecretKeys,
  hydrateEnvironmentSecretVariables,
} from './environment-secrets';

test('round trips distinct initial and current environment secret values', () => {
  const values = { initialValue: 'first', currentValue: 'latest' };
  assert.deepEqual(
    decodeEnvironmentSecret(encodeEnvironmentSecret(values)),
    values,
  );
});

test('decodes legacy environment secrets as both values', () => {
  assert.deepEqual(decodeEnvironmentSecret('legacy-value'), {
    initialValue: 'legacy-value',
    currentValue: 'legacy-value',
  });
});

test('collects unique secret keys from environment nodes', () => {
  assert.deepEqual(
    getEnvironmentSecretKeys([
      {
        config: {
          variables: [
            { key: 'TOKEN', type: 'secret' },
            { key: 'NAME', type: 'default' },
          ],
        },
      },
      { config: { variables: [{ key: 'TOKEN', type: 'secret' }] } },
    ]),
    ['TOKEN'],
  );
});

test('hydrates secret environment variables without changing stored nodes', () => {
  const nodes = [
    {
      id: 'environment-1',
      config: {
        variables: [
          {
            id: 'secret-1',
            key: 'TOKEN',
            type: 'secret',
            initialValue: '********',
            currentValue: '********',
          },
          {
            id: 'text-1',
            key: 'NAME',
            type: 'default',
            initialValue: 'Playrunner',
            currentValue: 'Playrunner',
          },
        ],
      },
    },
  ];
  const hydrated = hydrateEnvironmentSecretVariables(
    nodes,
    new Map([
      [
        'TOKEN',
        encodeEnvironmentSecret({
          initialValue: 'initial-token',
          currentValue: 'current-token',
        }),
      ],
    ]),
  ) as typeof nodes;

  assert.deepEqual(hydrated[0].config.variables[0], {
    id: 'secret-1',
    key: 'TOKEN',
    type: 'secret',
    initialValue: 'initial-token',
    currentValue: 'current-token',
  });
  assert.equal(hydrated[0].config.variables[1], nodes[0].config.variables[1]);
  assert.equal(nodes[0].config.variables[0].currentValue, '********');
});
