import assert from "node:assert/strict";
import test from "node:test";
import { getPagination } from "../src/lib/pagination";

test("keeps five payment records on each page and computes the final page", () => {
  assert.deepEqual(getPagination(12, 5, 1), {
    page: 1,
    pageCount: 3,
    startIndex: 0,
    endIndex: 5,
  });
  assert.deepEqual(getPagination(12, 5, 3), {
    page: 3,
    pageCount: 3,
    startIndex: 10,
    endIndex: 15,
  });
});

test("clamps invalid pages and represents an empty history with one page", () => {
  assert.deepEqual(getPagination(0, 5, 4), {
    page: 1,
    pageCount: 1,
    startIndex: 0,
    endIndex: 5,
  });
  assert.deepEqual(getPagination(6, 5, 0), {
    page: 1,
    pageCount: 2,
    startIndex: 0,
    endIndex: 5,
  });
  assert.deepEqual(getPagination(6, 5, 8), {
    page: 2,
    pageCount: 2,
    startIndex: 5,
    endIndex: 10,
  });
});
