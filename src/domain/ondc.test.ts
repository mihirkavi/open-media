import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeIndianPhone, ondcPrice, parseIndianGps, validateOndcStore } from './ondc';

const complete = {
  enabled: true, storeName: 'Asha Handlooms', category: 'ONDC:RET12', building: '12 MG Road', locality: 'Ashok Nagar', city: 'Bengaluru', state: 'Karnataka',
  areaCode: '560001', stdCode: '80', gps: '12.9716, 77.5946', phone: '+91 98765 43210', email: 'Asha@Example.test', declarationAccepted: true,
};

test('a complete store normalises its phone, STD code, GPS and email', () => {
  const { store, errors } = validateOndcStore(complete);
  assert.deepEqual(errors, {});
  assert.equal(store.phone, '9876543210');
  assert.equal(store.stdCode, '080');
  assert.equal(store.gps, '12.971600,77.594600');
  assert.equal(store.email, 'asha@example.test');
  assert.equal(store.timeToShip, 'P3D');
});

test('turning a store on needs every field and the declaration; a store that is off may be a draft', () => {
  assert.deepEqual(validateOndcStore({ storeName: 'Draft' }).errors, {});
  const { errors } = validateOndcStore({ ...complete, areaCode: '056001', gps: '51.5,-0.12', phone: '12345', declarationAccepted: false, category: 'ONDC:RET10' });
  assert.ok(errors.areaCode && errors.gps && errors.phone && errors.declarationAccepted);
  assert.equal(validateOndcStore({ ...complete, category: 'ONDC:RET10' }).store.category, 'ONDC:RET16', 'food needs FSSAI details, so it is not offered');
});

test('helpers', () => {
  assert.equal(normalizeIndianPhone('09876543210'), '9876543210');
  assert.equal(parseIndianGps('28.6139,77.2090')?.lat, 28.6139);
  assert.equal(parseIndianGps('40.7,-74'), undefined);
  assert.equal(ondcPrice(150050), '1500.50');
});
