/**
 * Locale-aware number parsing. The AADE modal and the Oxygen UI may render
 * quantities and prices in Greek (`5,796`), European (`1.234,56`), US
 * (`1,234.56`), or plain (`5.796`) style. parseMoney needs to preserve the
 * intent in every case. The cases below are the ones that have bitten us in
 * production — keep them green.
 */

import { parseMoney, parseAreaFromName } from '../src/shared/util.ts'

function assert(actual, expected, label) {
  const pass = Object.is(actual, expected)
  if (pass) {
    console.log('✓', label, '→', actual)
  } else {
    console.error('❌', label, '→ got', actual, 'expected', expected)
    process.exitCode = 1
  }
}

// Plain integers
assert(parseMoney('0'), 0, '"0"')
assert(parseMoney('42'), 42, '"42"')

// Single-dot decimal — the regression that prompted this rewrite
assert(parseMoney('5.796'), 5.796, '"5.796" → decimal (was incorrectly 5796)')
assert(parseMoney('0.5'), 0.5, '"0.5"')
assert(parseMoney('2.42'), 2.42, '"2.42"')

// Single-comma decimal (Greek)
assert(parseMoney('5,796'), 5.796, '"5,796" → Greek decimal')
assert(parseMoney('0,5'), 0.5, '"0,5"')

// Both present — European (`1.234,56`)
assert(parseMoney('1.234,56'), 1234.56, '"1.234,56" → European')
assert(parseMoney('1.000.000,00'), 1000000, '"1.000.000,00" → European large')

// Both present — US (`1,234.56`)
assert(parseMoney('1,234.56'), 1234.56, '"1,234.56" → US')
assert(parseMoney('1,000,000.00'), 1000000, '"1,000,000.00" → US large')

// Multi-dot, no comma → thousand separators only
assert(parseMoney('1.234.567'), 1234567, '"1.234.567" → pure thousands')

// Multi-comma, no dot → thousand separators only (rare)
assert(parseMoney('1,234,567'), 1234567, '"1,234,567" → pure thousands')

// Negatives
assert(parseMoney('-5.5'), -5.5, '"-5.5"')
assert(parseMoney('-5,5'), -5.5, '"-5,5"')

// Currency / whitespace strip
assert(parseMoney('€ 5,796'), 5.796, '"€ 5,796" strips currency symbol')
assert(parseMoney('  42,00 € '), 42, '"42,00 €" strips symbol + whitespace')

// Guards
assert(parseMoney(undefined), 0, 'undefined')
assert(parseMoney(null), 0, 'null')
assert(parseMoney(''), 0, 'empty string')
assert(parseMoney(3.14), 3.14, 'number passthrough')

/* -------------------------------------------------------- parseAreaFromName */

function aeq(actual, expected, label) {
  const pass = Math.abs(actual - expected) < 1e-6
  if (pass) console.log('✓', label, '→', actual.toFixed(3))
  else {
    console.error('❌', label, '→ got', actual, 'expected', expected)
    process.exitCode = 1
  }
}

// Pure mm (AADE norm — no suffix defaults to mm)
{
  const r = parseAreaFromName('ΤΖΑΜΙ 4100x640x8mm')
  if (!r) { console.error('❌ 4100x640x8mm parse failed'); process.exitCode = 1 }
  else {
    aeq(r.areaSqm, 2.624, '"4100x640x8mm" → 2.624 m²')
    aeq(r.mm.width, 4100, '"4100x640x8mm" → width 4100 mm')
    aeq(r.mm.length, 640, '"4100x640x8mm" → length 640 mm')
    aeq(r.mm.height ?? -1, 8, '"4100x640x8mm" → height 8 mm')
  }
}

// cm with 3 dims gets normalised to mm
{
  const r = parseAreaFromName('ΤΑΒΛΑ 120x80x3cm')
  if (!r) { console.error('❌ 120x80x3cm parse failed'); process.exitCode = 1 }
  else {
    aeq(r.mm.width, 1200, '"120x80x3cm" → width 1200 mm')
    aeq(r.mm.length, 800, '"120x80x3cm" → length 800 mm')
    aeq(r.mm.height ?? -1, 30, '"120x80x3cm" → height 30 mm')
  }
}

// 2-dim only → height is undefined
{
  const r = parseAreaFromName('ΠΛΑΚΑΚΙ 600x600mm')
  if (!r) { console.error('❌ 600x600mm parse failed'); process.exitCode = 1 }
  else {
    aeq(r.mm.width, 600, '"600x600mm" → width 600 mm')
    aeq(r.mm.length, 600, '"600x600mm" → length 600 mm')
    if (r.mm.height !== undefined) { console.error('❌ expected undefined height, got', r.mm.height); process.exitCode = 1 }
    else console.log('✓ "600x600mm" → height undefined (2-dim only)')
  }
}

// cm
{
  const r = parseAreaFromName('ΠΛΑΚΑΚΙ 60x60cm')
  if (!r) { console.error('❌ 60x60cm parse failed'); process.exitCode = 1 }
  else aeq(r.areaSqm, 0.36, '"60x60cm" → 0.36 m²')
}

// m with decimal
{
  const r = parseAreaFromName('ΞΥΛΟ 2.5x1.2m')
  if (!r) { console.error('❌ 2.5x1.2m parse failed'); process.exitCode = 1 }
  else aeq(r.areaSqm, 3.0, '"2.5x1.2m" → 3.0 m²')
}

// mm with whitespace and capital X
{
  const r = parseAreaFromName('ΠΑΝΕΛ 1200 X 2400 mm')
  if (!r) { console.error('❌ 1200x2400 parse failed'); process.exitCode = 1 }
  else aeq(r.areaSqm, 2.88, '"1200 X 2400 mm" → 2.88 m²')
}

// unicode multiplication sign
{
  const r = parseAreaFromName('GLASS 800×600mm')
  if (!r) { console.error('❌ unicode × parse failed'); process.exitCode = 1 }
  else aeq(r.areaSqm, 0.48, '"800×600mm" → 0.48 m²')
}

// No dimensions → null
{
  const r = parseAreaFromName('ΜΑΣΤΟΙ ΑΡΣ. 20mm 3/4" PEX-AL PRESS')
  if (r) {
    // "20mm" alone isn't WxH — should NOT match
    console.error('❌ "20mm 3/4" false-positive:', r)
    process.exitCode = 1
  } else console.log('✓ no WxH pattern → null')
}

console.log(process.exitCode ? '\nSome parseMoney cases failed.' : '\nAll parseMoney cases passed.')
