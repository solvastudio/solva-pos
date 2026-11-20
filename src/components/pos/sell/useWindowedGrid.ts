import { useCallback, useEffect, useState, type RefObject } from 'react'

export interface WindowedGridOptions {
  totalItems: number
  columns: number
  rowHeight: number
  gap?: number
  overscanRows?: number
  defaultViewportHeight?: number
}

export interface WindowedGridState {
  startIndex: number
  endIndex: number
  totalHeight: number
  paddingTop: number
  onScroll: () => void
}

export function computeWindowedRange(params: {
  totalItems: number
  columns: number
  rowHeight: number
  gap: number
  scrollTop: number
  viewportHeight: number
  overscanRows: number
}): { startIndex: number; endIndex: number; totalHeight: number; paddingTop: number } {
  const cols = Math.max(1, params.columns)
  const totalRows = Math.ceil(params.totalItems / cols)
  const stride = params.rowHeight + params.gap
  const totalHeight =
    totalRows === 0 ? 0 : totalRows * params.rowHeight + (totalRows - 1) * params.gap

  if (params.totalItems === 0 || stride <= 0) {
    return { startIndex: 0, endIndex: 0, totalHeight: 0, paddingTop: 0 }
  }

  const firstVisibleRow = Math.max(0, Math.floor(params.scrollTop / stride))
  const visibleRowCount = Math.max(1, Math.ceil(params.viewportHeight / stride) + 1)
  const startRow = Math.max(0, firstVisibleRow - params.overscanRows)
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRowCount + params.overscanRows)

  return {
    startIndex: startRow * cols,
    endIndex: Math.min(params.totalItems, endRow * cols),
    totalHeight,
    paddingTop: startRow * stride,
  }
}

/**
 * Lightweight fixed-height grid windowing without external virtualization libs.
 * Guarantees at most ~60 rendered card DOM nodes regardless of 5,000-item catalog size.
 */
export function useWindowedGrid(
  containerRef: RefObject<HTMLElement | null>,
  opts: WindowedGridOptions,
): WindowedGridState {
  const gap = opts.gap ?? 12
  const overscanRows = opts.overscanRows ?? 2
  const defaultHeight = opts.defaultViewportHeight ?? 640

  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: defaultHeight })

  const syncMetrics = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const nextScroll = el.scrollTop
    const nextHeight = el.clientHeight > 0 ? el.clientHeight : defaultHeight
    setMetrics((prev) =>
      prev.scrollTop === nextScroll && prev.viewportHeight === nextHeight
        ? prev
        : { scrollTop: nextScroll, viewportHeight: nextHeight },
    )
  }, [containerRef, defaultHeight])

  useEffect(() => {
    syncMetrics()
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncMetrics)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef, syncMetrics])

  const range = computeWindowedRange({
    totalItems: opts.totalItems,
    columns: opts.columns,
    rowHeight: opts.rowHeight,
    gap,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    overscanRows,
  })

  return {
    ...range,
    onScroll: syncMetrics,
  }
}
