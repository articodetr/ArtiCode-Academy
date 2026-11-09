import { describe, expect, it } from 'vitest'
import { isHttpsLink, scoreText } from './submissions.format'

describe('submissions.format', () => {
  it('writes a score against the max score', () => {
    expect(scoreText(17.5, 20)).toBe('17.5 / 20')
    expect(scoreText(0, 9999.99)).toBe('0 / 9999.99')
  })

  it('opens only an https link without spaces, as the DTO accepts it', () => {
    expect(isHttpsLink('https://docs.example.com/answer')).toBe(true)
    expect(isHttpsLink('http://docs.example.com/answer')).toBe(false)
    expect(isHttpsLink('javascript:alert(1)')).toBe(false)
    expect(isHttpsLink('https://docs.example.com/my answer')).toBe(false)
    expect(isHttpsLink(null)).toBe(false)
    expect(isHttpsLink(undefined)).toBe(false)
  })
})
