import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fromEcuadorInput,ecuadorInput,ecuadorDay,dayGroups,stages} from '../src/domain.js';
test('Ecuador dates and one official stage definition',()=>{
 assert.equal(fromEcuadorInput('2026-10-06T09:00'),'2026-10-06T14:00:00.000Z');
 assert.equal(ecuadorInput('2026-10-06T14:00:00Z'),'2026-10-06T09:00');
 assert.equal(ecuadorDay('2026-10-06T03:00:00Z'),'2026-10-05');
 const groups=dayGroups([{id:1,due_at:'2026-10-05T09:00:00-05:00'},{id:2,due_at:'2026-10-06T09:00:00-05:00'},{id:3,due_at:'2026-10-07T09:00:00-05:00'}],new Date('2026-10-06T10:00:00-05:00'));
 assert.deepEqual(groups.overdue.map(x=>x.id),[1]);assert.deepEqual(groups.today.map(x=>x.id),[2]);assert.deepEqual(groups.upcoming.map(x=>x.id),[3]);assert.equal(stages.length,9);
});
