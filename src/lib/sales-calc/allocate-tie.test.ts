import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { allocateComponentLR } from './allocate'

describe('LR tie-break oleh nomor baris (BR-MNY-006 langkah 4)', () => {
  it('seri pecahan dimenangkan baris dengan nomor lebih kecil, bukan posisi array', () => {
    // Dua bobot sama (16 & 16), total 19 ⇒ basis 9 + 9, sisa 1 untuk nomor baris 1.
    const inOrder = allocateComponentLR(toMoney(19), [16, 16], [1, 2])
    const reversed = allocateComponentLR(toMoney(19), [16, 16], [2, 1])
    expect(inOrder).toEqual([toMoney(10), toMoney(9)])
    // Urutan penyajian dibalik, tetapi nomor baris 1 tetap menerima sisa.
    expect(reversed).toEqual([toMoney(9), toMoney(10)])
  })

  it('tanpa tieRank, perilaku lama (urutan indeks) tetap berlaku untuk pemanggil lama', () => {
    expect(allocateComponentLR(toMoney(19), [16, 16])).toEqual([toMoney(10), toMoney(9)])
  })
})
