// @vitest-environment jsdom
/**
 * CopyTextButton（P5a 导出增强）：三态机微缩版——空文本禁用、copy 注入
 * 收全文、copied 一秒复位、拒绝写保持 idle 可重试。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { CopyTextButton } from '../../src/client/workbench/copy-text-button.js'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CopyTextButton', () => {
  it('空文本禁用；点击后 copy 收全文并短暂显示 copied', async () => {
    const copy = vi.fn(async () => true)
    const { rerender } = render(<CopyTextButton t={bindZh()} text="" copy={copy} />)
    const button = () => screen.getByRole('button', { name: workbenchZh['wp.copyBody'] }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    fireEvent.click(button())
    expect(copy).not.toHaveBeenCalled()

    rerender(<CopyTextButton t={bindZh()} text="# 计划正文" copy={copy} />)
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    expect(copy).toHaveBeenCalledWith('# 计划正文')
    await waitFor(() => expect(screen.getByText(workbenchZh['sow.copied'])).toBeTruthy())
    await new Promise((resolve) => { setTimeout(resolve, 1100) })
    expect(screen.getByText(workbenchZh['wp.copyBody'])).toBeTruthy()
  })

  it('拒绝写保持 idle 可重试', async () => {
    const copy = vi.fn(async () => false)
    render(<CopyTextButton t={bindZh()} text="x" copy={copy} />)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['wp.copyBody'] }))
    expect(await screen.findByText(workbenchZh['wp.copyBody'])).toBeTruthy() // 仍在 idle
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['wp.copyBody'] }))
    expect(copy).toHaveBeenCalledTimes(2)
  })
})
