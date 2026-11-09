import {describe,it,expect} from 'vitest';
import {automaticBoardName,radioBoardName} from './board-name';
import {emptyRadioState,rememberBoard,normalizeRadioState} from './account-state';
describe('radio board names',()=>{
  it('prefers the firmware name and preserves emoji, with Bluetooth and node fallbacks',()=>{
    expect(automaticBoardName('🐰 Дом','H','BLE',100)).toBe('🐰 Дом');
    expect(automaticBoardName('',undefined,'🌲',100)).toBe('🌲');
    expect(automaticBoardName(undefined,undefined,undefined,100)).toBe('Meshtastic !00000064');
    expect(radioBoardName('🐰'.repeat(20))).toBe('🐰'.repeat(16));
    expect(radioBoardName('\u0000Home\n')).toBe('Home');
  });
  it('refreshes automatic names across saved reconnects without overwriting a user label',()=>{
    const board={node:100,network:'a'.repeat(64),channel:1,name:'Meshtastic !00000064',firmware:'2.8',lastSeen:1};
    let state=rememberBoard(emptyRadioState(),board);
    state=rememberBoard(normalizeRadioState(state),{...board,name:'🐰',customName:false});
    expect(state.boards?.[0].name).toBe('🐰');expect(normalizeRadioState(state).boards?.[0].customName).toBe(false);
    state=rememberBoard(normalizeRadioState(state),{...board,name:'🌲',customName:false});expect(state.boards?.[0].name).toBe('🌲');
    state={...state,boards:state.boards!.map(b=>({...b,name:'My radio',customName:true}))};
    expect(rememberBoard(normalizeRadioState(state),{...board,name:'🐰'}).boards?.[0].name).toBe('My radio');
  });
});
