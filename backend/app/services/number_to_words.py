# Converts a rupee amount into words using the Indian numbering system
# (crore/lakh/thousand/hundred), for the invoice PDF's "Total in words" line
# — e.g. 25960.0 -> "TWENTY-FIVE THOUSAND NINE HUNDRED AND SIXTY RUPEES ONLY".
_ONES = [
    "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
    "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
    "SEVENTEEN", "EIGHTEEN", "NINETEEN",
]
_TENS = [
    "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY",
]


def _two_digits(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return f"{_TENS[tens]}-{_ONES[ones]}" if ones else _TENS[tens]


def _three_digits(n: int) -> str:
    hundreds, rest = divmod(n, 100)
    if hundreds and rest:
        return f"{_ONES[hundreds]} HUNDRED AND {_two_digits(rest)}"
    if hundreds:
        return f"{_ONES[hundreds]} HUNDRED"
    return _two_digits(rest)


def _integer_to_words(n: int) -> str:
    if n == 0:
        return "ZERO"

    crore, remainder = divmod(n, 10_000_000)
    lakh, remainder = divmod(remainder, 100_000)
    thousand, remainder = divmod(remainder, 1_000)
    hundred = remainder

    parts = []
    if crore:
        parts.append(f"{_integer_to_words(crore)} CRORE")
    if lakh:
        parts.append(f"{_two_digits(lakh) if lakh < 100 else _three_digits(lakh)} LAKH")
    if thousand:
        parts.append(f"{_two_digits(thousand) if thousand < 100 else _three_digits(thousand)} THOUSAND")
    if hundred:
        parts.append(_three_digits(hundred))

    return " ".join(parts)


def rupees_to_words(amount: float) -> str:
    rupees = int(round(amount))
    return f"{_integer_to_words(rupees)} RUPEES ONLY"
