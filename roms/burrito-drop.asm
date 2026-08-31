; BURRITO DROP -- an original CHIP-8 game by Sameed Ahmed (BastaMasta)
; Assembles to roms/burrito-drop.ch8, load address 0x200.
; Controls: 4 = left, 6 = right.
; Uses no quirk-dependent opcodes (no SHR/SHL; VF is always set immediately
; before it is read), so it behaves the same on COSMAC-VIP and SUPER-CHIP
; style interpreters.

start:
  CLS
  LD V0, 28              ; paddle centred
  LD V3, 0               ; score, ones
  LD V4, 0               ; score, tens
  LD V5, 0               ; tens last drawn
  LD V9, 0               ; ones last drawn
  LD VE, 0               ; throttle
  LD VD, 30              ; paddle row
  CALL draw_paddle
  LD VB, 1               ; draw the initial 00 directly -- going through
  LD VA, 1               ; draw_score would XOR it away again, since the
  LD F, V4               ; digit being erased and the one being drawn
  DRW VA, VB, 5          ; are the same glyph on the first frame
  LD VA, 6
  LD F, V3
  DRW VA, VB, 5
  CALL new_item
  CALL draw_item

loop:
  ; ---- pace the frame off the delay timer (~30fps) ----
  LD V6, 2
  LD DT, V6
wait:
  LD V6, DT
  SE V6, 0
  JP wait

  ; ---- paddle ----
  CALL draw_paddle       ; XOR erase
  LD V6, 4
  SKNP V6
  JP move_left
  LD V6, 6
  SKNP V6
  JP move_right
  JP after_move

move_left:
  SE V0, 0               ; already at the wall?
  JP do_left
  JP after_move
do_left:
  LD V6, 2
  SUB V0, V6
  JP after_move

move_right:
  SE V0, 56              ; 64 - paddle width
  JP do_right
  JP after_move
do_right:
  LD V6, 2
  ADD V0, V6

after_move:
  CALL draw_paddle       ; redraw

  ; ---- the item falls every other frame ----
  LD V6, 1
  XOR VE, V6
  SE VE, 0
  JP loop

  CALL draw_item         ; XOR erase
  ADD V2, 1
  LD V7, V2
  LD V6, 27              ; has it reached the paddle row?
  SUB V7, V6
  SE VF, 1
  JP still_falling
  JP landed

still_falling:
  CALL draw_item
  JP loop

  ; ---- it landed: did the paddle catch it? ----
landed:
  LD V7, V1
  SUB V7, V0             ; V7 = item.x - paddle.x
  SE VF, 1
  JP respawn             ; borrowed: item was left of the paddle
  LD V8, V7
  LD V6, 8
  SUB V8, V6             ; V7 >= 8 means it fell off the right end
  SE VF, 0
  JP respawn

  ; caught it
  LD V6, 2
  LD ST, V6              ; short beep
  ADD V3, 1
  LD V7, V3
  LD V6, 10
  SUB V7, V6             ; ones reached ten?
  SE VF, 1
  JP no_carry
  LD V3, 0               ; carry into the tens
  ADD V4, 1
  LD V7, V4
  LD V6, 10
  SUB V7, V6             ; and roll over at a hundred
  SE VF, 1
  JP no_carry
  LD V4, 0
no_carry:
  CALL draw_score

respawn:
  CALL new_item
  CALL draw_item
  JP loop

  ; ---- subroutines ----
draw_paddle:
  LD I, pad_spr
  DRW V0, VD, 2
  RET

draw_item:
  LD I, item_spr
  DRW V1, V2, 4
  RET

new_item:
  RND V1, 60             ; 0..60, so the 4px sprite stays on screen
  LD V2, 0
  RET

draw_score:
  LD VB, 1
  LD VA, 1               ; tens column
  LD F, V5               ; erase what is on screen
  DRW VA, VB, 5
  LD F, V4               ; draw the new one
  DRW VA, VB, 5
  LD V5, V4
  LD VA, 6               ; ones column
  LD F, V9
  DRW VA, VB, 5
  LD F, V3
  DRW VA, VB, 5
  LD V9, V3
  RET

pad_spr:
  DB 0xFF, 0xFF

item_spr:
  DB 0x60, 0xF0, 0xF0, 0x60
