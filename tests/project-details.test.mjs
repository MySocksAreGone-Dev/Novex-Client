import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {secureFetch} from '../electron/downloads.js';
const source=await fs.readFile(new URL('../src/services/projectDetails.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {projectRequest,safeProjectURL}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
test('project links reject executable/local URLs and embedded credentials',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','file:///secret','http://localhost/x','https://user:pass@example.org'])assert.equal(safeProjectURL(url),undefined);
 assert.equal(safeProjectURL('https://modrinth.com/mod/sodium'),'https://modrinth.com/mod/sodium');
 const rendered=renderToStaticMarkup(React.createElement(Markdown,{skipHtml:true,remarkPlugins:[remarkGfm],urlTransform:url=>safeProjectURL(url)||''},'# Title\n\n**Bold**\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n![bad](file:///secret)\n\n| A | B |\n| - | - |\n| C | D |'));
 assert.match(rendered,/<h1>Title<\/h1>/);assert.match(rendered,/<strong>Bold<\/strong>/);assert.match(rendered,/<table>/);assert.doesNotMatch(rendered,/<script|onerror|javascript:|file:\/\//i);
});
test('project requests coalesce, cache and recover after offline failures',async t=>{
 const original=global.fetch;t.after(()=>global.fetch=original);let calls=0;
 global.fetch=async()=>{calls++;return new Response(JSON.stringify({title:'Fixture'}));};
 const result=await Promise.all([projectRequest('project/fixture'),projectRequest('project/fixture')]);assert.equal(calls,1);assert.equal(result[0].title,'Fixture');await projectRequest('project/fixture');assert.equal(calls,1);
 global.fetch=async()=>{throw new Error('offline');};await assert.rejects(projectRequest('project/offline'));
 global.fetch=async()=>new Response('{}');await projectRequest('project/offline');
});
test('pack download host restrictions apply to every redirect',async t=>{
 const original=global.fetch;t.after(()=>global.fetch=original);let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});};
 await assert.rejects(secureFetch('https://cdn.modrinth.com/file',{allowedHosts:['cdn.modrinth.com']}),/not permitted/);assert.equal(calls,1);
});
