// A course or class code in brackets after its name, on the certificate
// screens (V3 D3): the brackets sit inside one left-to-right isolate, so they
// never mirror around the code in an Arabic line, and the isolate is an
// inline block, so it moves to the next line whole instead of breaking at a
// hyphen of the code — it wraps inside only when the code alone is wider than
// the line.
export function BracketedCode({ code }: { code: string }) {
  return (
    <bdi dir="ltr" style={{ display: 'inline-block' }} data-testid="bracketed-code">
      ({code})
    </bdi>
  )
}
