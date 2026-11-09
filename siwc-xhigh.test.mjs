import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanProvider } from './siwc.mjs';

test('independent personal Sol requests explicit xhigh with no API key fallback', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalAzure = process.env.AZURE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  let payload = null;
  const future = Date.now() + 600000;
  const resultText = '{"review":"manual_only"}';
  const events = [
    'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: resultText }),
    '',
    'data: ' + JSON.stringify({ type: 'response.completed', response: {
      id: 'resp_test_only', status: 'completed', model: 'gpt-6.1-sol',
      output: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: resultText }] }]
    }}),
    '',
    ''
  ].join('\n');
  const fetcher = async (url, init = {}) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({
      models: [{slug: 'gpt-6.1-sol', visibility: 'list', display_name: 'GPT-6.1 Sol'}]
    }), {status:200,headers:{'content-type':'application/json'}});
    if (String(url).endsWith('/responses')) {
      payload = JSON.parse(init.body);
      return new Response(events,{status:200,headers:{'content-type':'text/event-stream'}});
    }
    throw new Error('UNEXPECTED_URL');
  };
  try {
    const client = new PlanProvider({
      scopes: ['chatgpt.tokens.use.direct'], expiresAt: future,
      accessToken: 'synthetic-test-token'
    }, fetcher);
    const result = await client.infer({
      model: 'gpt-6.1-sol', instructions: 'Rispondi in JSON.',
      role: 'Owner Analyst', version: 'test-v1',
      input: {market: 'IT'}, documents: [], memory: []
    }, {expiresAt:future});
    assert.equal(payload.model,'gpt-6.1-sol');
    assert.deepEqual(payload.reasoning,{effort:'xhigh'});
    assert.equal(payload.store,false);
    assert.equal(payload.stream,true);
    assert.deepEqual(payload.tools,[]);
    assert.equal(result.completed,true);
    assert.equal(result.observedModel,'gpt-6.1-sol');
    assert.equal(result.text,resultText);
  } finally {
    if(originalKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=originalKey;
    if(originalAzure===undefined)delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY=originalAzure;
  }
});

test('a completed stream without exact model evidence is rejected, not certified', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousAzure = process.env.AZURE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  const future = Date.now() + 600000;
  let postCount = 0;
  try {
    for (const observed of [null, 'gpt-6.1-terra']) {
      const fetcher = async (url) => {
        if (String(url).endsWith('/models')) return new Response(JSON.stringify({
          models: [{slug:'gpt-6.1-sol',visibility:'list',display_name:'GPT-6.1 Sol'}]
        }), {status:200,headers:{'content-type':'application/json'}});
        if (String(url).endsWith('/responses')) {
          postCount++;
          const message = {type:'response.completed',response:{
            status:'completed',id:'resp_test_only',
            ...(observed === null ? {} : {model: observed}),
            output:[{type:'message',role:'assistant',content:[
              {type:'output_text',text:'{"ok":true}'}
            ]}]
          }};
          return new Response('data: '+JSON.stringify(message)+'\n\n',
            {status:200,headers:{'content-type':'text/event-stream'}});
        }
        throw new Error('UNEXPECTED_URL');
      };
      const client = new PlanProvider({
        scopes:['chatgpt.tokens.use.direct'],expiresAt:future,
        accessToken:'synthetic-test-token'
      },fetcher);
      await assert.rejects(client.infer({
        model:'gpt-6.1-sol',instructions:'JSON.',role:'Owner Analyst',
        version:'test-v1',input:{},documents:[],memory:[]
      },{expiresAt:future}),(error) => error.code === 'RESPONSE_MODEL_NOT_ATTESTED');
    }
    assert.equal(postCount,2,'exactly one provider request per explicit test, no retry');
  } finally {
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
    if(previousAzure===undefined)delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY=previousAzure;
  }
});
