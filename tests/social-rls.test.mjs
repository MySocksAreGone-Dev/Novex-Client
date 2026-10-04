import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('social RLS rejects impersonation, non-friend messaging and forged friendship', async () => {
 const db=new PGlite();
 const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',c='33333333-3333-3333-3333-333333333333';
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await fs.readFile(new URL('../supabase_schema.sql',import.meta.url),'utf8'));
  await db.exec(`insert into auth.users values ('${a}','a@example.invalid','{}'),('${b}','b@example.invalid','{}'),('${c}','c@example.invalid','{}'); set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
  await assert.rejects(db.exec(`insert into public.messages(sender_id,receiver_id,content) values('${a}','${b}','Not friends')`));
  await assert.rejects(db.exec(`insert into public.friend_requests(from_id,to_id,status) values('${a}','${b}','accepted')`));
  await assert.rejects(db.exec(`insert into public.friends values('${a}','${b}',now())`));
  await assert.rejects(db.exec(`insert into public.friend_requests(from_id,to_id) values('${b}','${a}')`));
  const request=(await db.query(`insert into public.friend_requests(from_id,to_id) values('${a}','${b}') returning id`)).rows[0].id;
  await assert.rejects(db.exec(`select public.accept_friend_request('${request}')`));
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false); select public.accept_friend_request('${request}');`);
  await db.exec(`insert into public.messages(sender_id,receiver_id,content) values('${b}','${a}','Hello')`);
  await assert.rejects(db.exec(`insert into public.messages(sender_id,receiver_id,content) values('${a}','${b}','Impersonation')`));
  assert.equal((await db.query(`update public.profiles set username='hacked' where id='${a}' returning id`)).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${c}',false)`);
  assert.equal((await db.query('select * from public.messages')).rows.length,0);
  assert.equal((await db.query('select * from public.friend_requests')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.exec('select * from public.messages'));
  await assert.rejects(db.exec(`select public.accept_friend_request('${request}')`));
 } finally { await db.close(); }
});
