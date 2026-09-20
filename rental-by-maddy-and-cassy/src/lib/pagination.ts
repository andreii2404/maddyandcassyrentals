export interface PaginationState {
  page: number;
  pageCount: number;
  startIndex: number;
  endIndex: number;
}

export function getPagination(totalItems: number, pageSize: number, requestedPage: number): PaginationState {
  const safeTotalItems = Math.max(0, Math.floor(totalItems));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);

  return {
    page,
    pageCount,
    startIndex: (page - 1) * safePageSize,
    endIndex: page * safePageSize,
  };
}
