import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { pinProgress } from './useScrollProgress'
import { useTween } from './useTween'
import { DEFAULT_TITLE, useDocumentTitle } from './useDocumentTitle'
import { useFrame } from './useFrame'
import { useMedia } from './useMedia'

describe('pinProgress', () => {
  it('is 0 before the chapter pins, 1 after it ends', () => {
    expect(pinProgress(200, 3000, 800)).toBe(0)
    expect(pinProgress(0, 3000, 800)).toBe(0)
    expect(pinProgress(-1100, 3000, 800)).toBeCloseTo(0.5)
    expect(pinProgress(-5000, 3000, 800)).toBe(1)
  })
  it('never divides by zero', () => {
    expect(pinProgress(-10, 800, 800)).toBe(1)
  })
})

describe('useTween', () => {
  it('jumps to the target when instant', () => {
    const { result } = renderHook(() => useTween(0, 1000, 'k', 900, true))
    expect(result.current).toBe(1000)
  })
  it('stays at the start while inactive', () => {
    const { result } = renderHook(() => useTween(0, 1000, 'k', 900, false, false))
    expect(result.current).toBe(0)
  })
})

describe('useDocumentTitle', () => {
  function T({ title }: { title: string }) {
    useDocumentTitle(title)
    return null
  }
  it('sets the title and restores the default on unmount', () => {
    document.title = DEFAULT_TITLE
    const { unmount } = render(<T title="Hello" />)
    expect(document.title).toBe('Hello')
    unmount()
    expect(document.title).toBe(DEFAULT_TITLE)
  })
})

describe('useFrame', () => {
  it('ticks with a capped delta while running and stops after', () => {
    vi.useFakeTimers()
    const raf: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (raf.push(cb), raf.length))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const cb = vi.fn()
    const { rerender, unmount } = renderHook(({ on }) => useFrame(cb, on), { initialProps: { on: true } })
    act(() => raf.shift()!(1000))
    act(() => raf.shift()!(1500)) // 500 ms later, capped at 50 ms
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb.mock.calls[1][0]).toBeCloseTo(0.05)
    rerender({ on: false })
    unmount()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
})

describe('useMedia', () => {
  it('reports the query result', () => {
    function M() {
      return <span>{String(useMedia('(prefers-reduced-motion: reduce)'))}</span>
    }
    render(<M />)
    expect(screen.getByText('true')).toBeInTheDocument()
  })
})
