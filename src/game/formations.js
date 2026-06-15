/**
 * formations.js — 4-4-2 team sheets: names, position labels and base (home)
 * coordinates for every player. HOME attacks +X (own goal at −X); the AWAY team
 * is the same shape mirrored across the halfway line.
 *
 * The base coordinates are each player's resting slot; the match AI shifts them
 * elastically with the ball (line height, lateral compactness, push/drop by role)
 * so the team keeps its shape instead of everyone chasing the ball.
 */

// 4-4-2 in HOME's frame (own goal at −X). Index 0 is the keeper.
const SHAPE_442 = [
  { role: 'GK', label: 'GK', x: -50, z: 0 },
  { role: 'DF', label: 'LB', x: -34, z: -20 },
  { role: 'DF', label: 'LCB', x: -37, z: -7 },
  { role: 'DF', label: 'RCB', x: -37, z: 7 },
  { role: 'DF', label: 'RB', x: -34, z: 20 },
  { role: 'MF', label: 'LM', x: -13, z: -22 },
  { role: 'MF', label: 'LCM', x: -16, z: -8 },
  { role: 'MF', label: 'RCM', x: -16, z: 8 },
  { role: 'MF', label: 'RM', x: -13, z: 22 },
  { role: 'FW', label: 'LS', x: -2, z: -8 },
  { role: 'FW', label: 'RS', x: -2, z: 8 }
];

const NAMES = {
  HOME: ['Hart', 'Walker', 'Stones', 'Maguire', 'Shaw', 'Sterling', 'Rice', 'Bellingham', 'Foden', 'Kane', 'Saka'],
  AWAY: ['Sommer', 'Hakimi', 'Kimmich', 'Rudiger', 'Theo', 'Kroos', 'Modric', 'Pedri', 'Vinicius', 'Haaland', 'Mbappe']
};

export const ATTACK_SIGN = { HOME: 1, AWAY: -1 };

// Build the 11-player team sheet for a side. AWAY mirrors X.
export function teamSheet(team) {
  const mirror = team === 'AWAY';
  return SHAPE_442.map((slot, i) => ({
    name: NAMES[team][i],
    number: i === 0 ? 1 : i + 1,
    role: slot.role,
    label: slot.label,
    isKeeper: slot.role === 'GK',
    home: { x: mirror ? -slot.x : slot.x, z: slot.z }
  }));
}
