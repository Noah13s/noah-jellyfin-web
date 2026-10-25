import { describe, expect, it } from 'vitest';
import { guideDates } from './dateRange';

describe('guide calendar date iteration', () => {
    it('includes the final day across a leap day without mutating the inputs', () => {
        const start = new Date(2024, 1, 28, 15);
        const end = new Date(2024, 2, 1);
        const dates = guideDates(start, end);
        expect(dates.map(date => date.getDate())).toEqual([28, 29, 1]);
        expect(dates.map(date => date.getHours())).toEqual([15, 0, 0]);
        expect(start.getDate()).toBe(28);
        expect(end.getMonth()).toBe(2);
    });
    it('advances local calendar days through year and daylight-saving boundaries', () => {
        expect(guideDates(new Date(2025, 11, 31), new Date(2026, 0, 1)).map(date => date.getFullYear())).toEqual([2025, 2026]);
        expect(guideDates(new Date(2026, 2, 7), new Date(2026, 2, 10)).map(date => date.getDate())).toEqual([7, 8, 9, 10]);
    });
    it('terminates without entries for reversed or invalid dates', () => {
        expect(guideDates(new Date(2026, 1, 2), new Date(2026, 1, 1))).toEqual([]);
        expect(guideDates(new Date(NaN), new Date())).toEqual([]);
        expect(guideDates(new Date(), new Date(NaN))).toEqual([]);
    });
});
