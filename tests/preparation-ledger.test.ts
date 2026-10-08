import {describe,test,expect} from 'bun:test';
import {PreparationLedger} from '../src/preparation-ledger';
const key='a'.repeat(64);
function fixture(){const files=new Map<string,string>();return {files,storage:{read:async(user:string)=>files.get(user),write:async(user:string,value:string)=>{files.set(user,value)}}}}
describe('paid preparation history',()=>{
  test('a new backend session cannot automatically claim the same message again',async()=>{
    const {storage}=fixture();expect(await new PreparationLedger(storage).claim('one',key)).toBe(true);
    expect(await new PreparationLedger(storage).claim('one',key)).toBe(false);
  });
  test('simultaneous tabs claim one automatic request and retain the attempt before speech starts',async()=>{
    const {files,storage}=fixture(),ledger=new PreparationLedger(storage);
    expect(await Promise.all([ledger.claim('one',key),ledger.claim('one',key)])).toEqual([true,false]);
    expect(JSON.parse(files.get('one')!)).toEqual([key]);
  });
  test('failed, stopped and evicted audio require an explicit retry',async()=>{
    const {storage}=fixture(),ledger=new PreparationLedger(storage);
    expect(await ledger.claim('one',key)).toBe(true);
    expect(await ledger.claim('one',key)).toBe(false);expect(await ledger.claim('one',key,true)).toBe(true);expect(await ledger.claim('one',key)).toBe(false);
  });
  test('users have separate histories and new messages remain eligible',async()=>{
    const {storage}=fixture(),ledger=new PreparationLedger(storage);
    expect(await ledger.claim('one',key)).toBe(true);expect(await ledger.claim('two',key)).toBe(true);expect(await ledger.claim('one','b'.repeat(64))).toBe(true);
  });
  test('storage failures and corrupt history fail before authorizing paid generation',async()=>{
    const {files,storage}=fixture();files.set('one','not-json');expect(new PreparationLedger(storage).claim('one',key)).rejects.toThrow();
    expect(new PreparationLedger({...storage,write:async()=>{throw new Error('disk full')}}).claim('two',key)).rejects.toThrow('disk full');
    expect(new PreparationLedger(storage).claim('two','bad')).rejects.toThrow('identity');
  });
});
