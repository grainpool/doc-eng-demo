"""Kernel error type — maps to the contract's 400 body (contracts.md §4.3)."""


class KernelError(Exception):
    """Raised by dataset handling and operation handlers; becomes
    `400 { "error": { "code", "detail" } }`. Never carries a stack trace,
    a file path, or raw dataset content in `detail`."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail
