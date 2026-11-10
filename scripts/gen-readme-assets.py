#!/usr/bin/env python3
"""Generate the dedicated README artwork for dsh-nsfc-form-check.

Outputs (idempotent overwrite, all under docs/assets/):
  dsh-nsfc-form-check-hero-{zh,en}-{light,dark}.webp   1440x576 hero banner
  dsh-nsfc-form-check-flow-v5-{light,dark}.svg         1100x660 structure diagram

The artwork is derived from this repository only:

  * `src/parse.ts` turns one material into two channels — paragraph `lines[]`
    (with 1-based line numbers) and `metadata` (title / author / company /
    lastModifiedBy). A `.pdf` is refused, not guessed at.
  * `src/check.ts` runs 15 rules. NF-001 is the roster gate: with no configured
    identity terms the dependent checks are reported in `skipped` instead of
    passing silently.
  * The remaining 14 rules group by how they locate the material:
      - body identity:  NF-002, NF-003, NF-004, NF-013, NF-014 (NF-014 reversed)
      - property read:  NF-005, NF-006, NF-007, NF-008
      - policy/scope:   NF-009, NF-010, NF-011, NF-012, NF-015
  * `src/shared/ruleset.ts` caps severity by basis kind: a `direct` rule may be
    `error`, `derived-from-principle` may not exceed `warn`, and
    `institutional-configuration` may not exceed `info`.
  * `src/view.ts` renders the report as markdown + reportJson; `issues[]` and
    `skipped[]` are the two lists the user actually reads.

The flow is a two-channel / three-track / two-tray diagram with a roster gate
and a basis-kind severity ruler — deliberately not a row of five boxes. The old
flow-light/-dark SVGs and the terminal hero.png stay on disk for external links;
the READMEs no longer reference them.

Run:  python scripts/gen-readme-assets.py
Fonts: msyh.ttc, msyhbd.ttc, consola.ttf (verified, never tofu).
"""
from __future__ import annotations

import html
import os
import sys
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_SANS = r"C:\Windows\Fonts\msyh.ttc"
FONT_SANS_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
for _path in (FONT_SANS, FONT_SANS_BOLD, FONT_MONO):
    if not os.path.exists(_path):
        sys.exit(f"FATAL: required font missing: {_path}")

# ---------------------------------------------------------------------------
# palette
# ---------------------------------------------------------------------------
PALETTE = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        card="#ffffff", card2="#f7f8fd", panel="#ffffff",
        border="#d8dded", border2="#c6cde3",
        ink="#1b2340", muted="#5f6884", faint="#8b94ad",
        accent="#4B67B4", accent_soft="#eef1fb", accent_ink="#33477f",
        violet="#7A63B0", violet_soft="#f4f1fb",
        warn="#B45309", warn_soft="#fdf3e5",
        info="#3B6EA5", info_soft="#edf3fb",
        error="#B42318",
        on_accent="#ffffff",
        shadow=(31, 42, 80), shadow_alpha=34,
        track_a="#f2f5fc", track_c="#f2f5fc", track_b="#f6f3fc",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        card="#1a2233", card2="#202a40", panel="#1a2233",
        border="#2e3a55", border2="#3a4766",
        ink="#e9edf9", muted="#a2adc8", faint="#7b86a3",
        accent="#8496f5", accent_soft="#202a44", accent_ink="#b9c4ff",
        violet="#a99be8", violet_soft="#262139",
        warn="#e3b25f", warn_soft="#33291a",
        info="#82b3e8", info_soft="#1d2b40",
        error="#f08a7a",
        on_accent="#0c1016",
        shadow=(0, 0, 0), shadow_alpha=120,
        track_a="#1d2740", track_c="#1d2740", track_b="#232038",
    ),
}

CJK_RANGES = (
    (0x2E80, 0x9FFF), (0xF900, 0xFAFF), (0xFE30, 0xFE4F),
    (0xFF00, 0xFFEF), (0x3000, 0x303F),
)


def is_cjk(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in CJK_RANGES)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


_fonts: dict[tuple[int, bool, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold, mono)
    cached = _fonts.get(key)
    if cached is None:
        path = FONT_MONO if mono else (FONT_SANS_BOLD if bold else FONT_SANS)
        cached = ImageFont.truetype(path, size)
        _fonts[key] = cached
    return cached


def _runs(text: str, mono: bool) -> Iterable[tuple[str, bool, bool]]:
    """Split text into (chunk, bold, mono) runs; CJK always uses the sans face."""
    if not mono:
        yield text, False, False
        return
    buf: list[str] = []
    mode: bool | None = None
    for ch in text:
        chunk_mono = not is_cjk(ch)
        if mode is None or chunk_mono == mode:
            buf.append(ch)
            mode = chunk_mono
        else:
            yield "".join(buf), False, mode
            buf = [ch]
            mode = chunk_mono
    if buf:
        yield "".join(buf), False, mode  # type: ignore[arg-type]


def measure(text: str, size: int, bold: bool = False, mono: bool = False,
            tracking: float = 0.0) -> float:
    total = 0.0
    for chunk, chunk_bold, chunk_mono in _runs(text, mono):
        face = font(size, bold or chunk_bold, chunk_mono)
        total += face.getlength(chunk)
    if tracking:
        total += tracking * max(0, len(text) - 1)
    return total


def draw_text(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str,
              size: int, fill: str, bold: bool = False, mono: bool = False,
              anchor: str = "ls", tracking: float = 0.0) -> float:
    """Draw mixed CJK/Latin text on one baseline. `anchor` = ls / ms / rs."""
    total = measure(text, size, bold, mono, tracking)
    x, y = float(xy[0]), float(xy[1])
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    if tracking:
        cursor = x
        for ch in text:
            chunk_mono = mono and not is_cjk(ch)
            face = font(size, bold, chunk_mono)
            draw.text((cursor, y), ch, font=face, fill=fill, anchor="ls")
            cursor += face.getlength(ch) + tracking
        return total
    cursor = x
    for chunk, chunk_bold, chunk_mono in _runs(text, mono):
        face = font(size, bold or chunk_bold, chunk_mono)
        draw.text((cursor, y), chunk, font=face, fill=fill, anchor="ls")
        cursor += face.getlength(chunk)
    return total


# ---------------------------------------------------------------------------
# Pillow primitives
# ---------------------------------------------------------------------------
def gradient(size: tuple[int, int], c1: str, c2: str, radius: int) -> Image.Image:
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = (xx / max(1, w - 1)) * 0.55 + (yy / max(1, h - 1)) * 0.45
    a, b = np.array(rgb(c1), dtype=np.float32), np.array(rgb(c2), dtype=np.float32)
    arr = a + (b - a) * t[..., None]
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB").convert("RGBA")
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    img.putalpha(mask)
    return img


def glow(size: tuple[int, int], color: str, peak: int) -> Image.Image:
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    alpha = (np.clip(1.0 - dist, 0.0, 1.0) ** 2 * peak).astype(np.uint8)
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = rgb(color)
    arr[..., 3] = alpha
    return Image.fromarray(arr, "RGBA")


def add_glow(img: Image.Image, size: tuple[int, int], color: str, peak: int,
             xy: tuple[int, int]) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    layer.paste(glow(size, color, peak), xy)
    img.alpha_composite(layer)


def soft_shadow(img: Image.Image, box: tuple[float, float, float, float],
                radius: int, alpha: int, blur: int = 16,
                offset: tuple[int, int] = (0, 10)) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius=radius,
                                            fill=(0, 0, 0, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    shifted = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shifted.paste(layer, offset)
    img.alpha_composite(shifted)


def card(img: Image.Image, box: tuple[float, float, float, float], radius: int,
         fill: str, border: str, width: int = 1,
         alpha: int = 255) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=radius,
                           fill=(*rgb(fill), alpha), outline=(*rgb(border), 255),
                           width=width)
    img.alpha_composite(layer)


def soft_fill(img: Image.Image, box: tuple[float, float, float, float], radius: int,
              fill: str, alpha: int, outline: str | None = None) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=radius, fill=(*rgb(fill), alpha),
                           outline=(*rgb(outline), 255) if outline else None,
                           width=1 if outline else 0)
    img.alpha_composite(layer)


def hairline(img: Image.Image, x1: int, y1: int, x2: int, y2: int,
             color: str, alpha: int = 255, width: int = 1) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).line((x1, y1, x2, y2),
                               fill=(*rgb(color), alpha), width=width)
    img.alpha_composite(layer)


def dot(img: Image.Image, xy: tuple[int, int], color: str, r: int = 4,
        alpha: int = 255) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((xy[0] - r, xy[1] - r, xy[0] + r, xy[1] + r),
                                  fill=(*rgb(color), alpha))
    img.alpha_composite(layer)


# ---------------------------------------------------------------------------
# hero
# ---------------------------------------------------------------------------
COPY = {
    "zh": dict(
        kicker="DEEPSEEK HARNESS · 形式审查插件",
        subtitle="国自然申请书形式审查",
        value1="正文逐行、属性逐字段：命中处直接给出行号或字段名。",
        value2="未配置的检查写进 skipped——发现为空不等于通过。",
        meta="15 条规则 · 4 项文档属性 · 3 类名单 + allowList",
        footer="Apache-2.0 · 无联网 · 不调用模型 · 不写回原文件",
        props_title="文档属性",
        props_meta="metadata",
        prop_rows=["title", "author", "company", "lastModifiedBy"],
        tag1="NF-002 · 第 04 行",
        tag2="NF-006 · author",
        tag3="skipped[] · 未配置",
        caption="每条发现带条款与依据类型；每条未执行带原因。",
        name_term="张伟",
        unit_term="示例大学",
    ),
    "en": dict(
        kicker="DEEPSEEK HARNESS · FORM CHECK PLUGIN",
        subtitle="NSFC proposal form review",
        value1="Body line by line; properties field by field.",
        value2="Unrun checks go to skipped — empty is not a pass.",
        meta="15 rules · 4 doc properties · 3 rosters + allowList",
        footer="Apache-2.0 · no network · no model call · read-only",
        props_title="DOC PROPS",
        props_meta="metadata",
        prop_rows=["title", "author", "company", "lastModifiedBy"],
        tag1="NF-002 · line 04",
        tag2="NF-006 · author",
        tag3="skipped[] · unset",
        caption="Each finding names its clause; each skip its reason.",
        name_term="Zhang Wei",
        unit_term="Example Univ.",
    ),
}


def hero(lang: str, theme: str) -> Image.Image:
    p = PALETTE[theme]
    text = COPY[lang]
    W, H = 1440, 576
    img = gradient((W, H), p["bg1"], p["bg2"], 22)

    add_glow(img, (660, 660), p["accent"], 26 if theme == "light" else 46, (890, -190))
    add_glow(img, (460, 460), p["violet"], 16 if theme == "light" else 30, (-120, 330))

    # ---- left column -----------------------------------------------------
    left_x = 88
    draw = ImageDraw.Draw(img)
    draw_text(draw, (left_x, 86), text["kicker"], 18,
              p["accent"], bold=True, tracking=2.4)
    draw_text(draw, (left_x, 180), "dsh-nsfc", 84, p["ink"], bold=True)
    draw_text(draw, (left_x, 268), "form-check", 84, p["ink"], bold=True)
    draw_text(draw, (left_x, 320), text["subtitle"], 34,
              p["accent_ink"], bold=True)
    draw_text(draw, (left_x, 378), text["value1"], 25, p["muted"])
    draw_text(draw, (left_x, 412), text["value2"], 25, p["muted"])
    hairline(img, left_x, 440, left_x + 520, 440, p["border"], 220)
    draw_text(draw, (left_x, 472), text["meta"], 21, p["muted"])
    draw_text(draw, (left_x, 522), text["footer"], 18, p["faint"])

    # ---- right panel -----------------------------------------------------
    px, py, pw, ph = 806, 64, 562, 448
    soft_shadow(img, (px, py, px + pw, py + ph), 24,
                p["shadow_alpha"], blur=22, offset=(0, 14))
    card(img, (px, py, px + pw, py + ph), 24, p["panel"], p["border"],
         alpha=236 if theme == "light" else 255)

    # faint dotted texture inside the panel
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for yy in range(py + 22, py + ph - 14, 26):
        for xx in range(px + 22, px + pw - 14, 26):
            d.ellipse((xx, yy, xx + 2, yy + 2), fill=(*rgb(p["faint"]), 42))
    img.alpha_composite(layer)

    # ---- proposal sheet --------------------------------------------------
    sx, sy, sw, sh = 830, 92, 330, 336
    soft_shadow(img, (sx, sy, sx + sw, sy + sh), 20,
                p["shadow_alpha"] - 6, blur=18, offset=(0, 10))
    card(img, (sx, sy, sx + sw, sy + sh), 20, p["card"], p["border"])

    # sheet header
    soft_fill(img, (sx + 18, sy + 16, sx + 46, sy + 44), 8, p["accent_soft"], 255,
              outline=p["border"])
    for i, w in enumerate((14, 10, 14)):
        hairline(img, sx + 25, sy + 24 + i * 6, sx + 25 + w, sy + 24 + i * 6,
                 p["accent"], 210, 2)
    draw_text(draw, (sx + 56, sy + 36), "proposal.docx", 15,
              p["ink"], mono=True)
    draw_text(draw, (sx + sw - 18, sy + 36), "lines[]", 13,
              p["accent"], mono=True, anchor="rs")
    hairline(img, sx + 18, sy + 58, sx + sw - 18, sy + 58, p["border"], 220)

    # line rail
    rail_x = sx + 42
    hairline(img, rail_x, sy + 72, rail_x, sy + sh - 20, p["border"], 210)
    bars = [
        (154, 176, None), (184, 126, None), (214, 148, None),
        (244, 92, "name"), (274, 186, None), (304, 116, None),
        (334, 64, "unit"), (364, 198, None), (394, 138, None),
    ]
    for idx, (ry, bw, kind) in enumerate(bars, start=1):
        num = f"{idx:02d}"
        colour = p["faint"]
        if kind == "name":
            soft_fill(img, (sx + 8, ry - 12, sx + sw - 10, ry + 12), 7,
                      p["warn_soft"], 255)
            colour = p["warn"]
        elif kind == "unit":
            soft_fill(img, (sx + 8, ry - 12, sx + sw - 10, ry + 12), 7,
                      p["violet_soft"], 255)
            colour = p["violet"]
        draw_text(draw, (sx + 26, ry + 4), num, 13, colour,
                  mono=True, anchor="rs")
        if kind is None:
            soft_fill(img, (sx + 52, ry - 4, sx + 52 + bw, ry + 4), 4,
                      p["border2"], 190)
        else:
            soft_fill(img, (sx + 52, ry - 4, sx + 52 + bw, ry + 4), 4,
                      p["border2"], 190)
            term = text["name_term"] if kind == "name" else text["unit_term"]
            tw = int(measure(term, 13, mono=False)) + 22
            tx = sx + 52 + bw + 8
            soft_fill(img, (tx, ry - 11, tx + tw, ry + 11), 11,
                      p["warn"] if kind == "name" else p["violet"], 26)
            draw_text(draw, (tx + tw / 2, ry + 5), term, 13,
                      p["warn"] if kind == "name" else p["violet"],
                      anchor="ms")

    # ---- properties card -------------------------------------------------
    qx, qy, qw, qh = 1174, 118, 186, 302
    soft_shadow(img, (qx, qy, qx + qw, qy + qh), 18,
                p["shadow_alpha"] - 6, blur=16, offset=(0, 10))
    card(img, (qx, qy, qx + qw, qy + qh), 18, p["card"], p["border"])
    draw_text(draw, (qx + 18, qy + 32), text["props_title"], 15,
              p["ink"], bold=True)
    draw_text(draw, (qx + 18, qy + 52), text["props_meta"], 12,
              p["faint"], mono=True)
    hairline(img, qx + 18, qy + 64, qx + qw - 18, qy + 64, p["border"], 220)

    row_y = [qy + 88, qy + 128, qy + 168, qy + 208]
    values = [None, text["name_term"], text["unit_term"], None]
    for i, (ry, prop) in enumerate(zip(row_y, text["prop_rows"])):
        if i == 1:
            soft_fill(img, (qx + 10, ry - 14, qx + qw - 10, ry + 24), 8,
                      p["warn_soft"], 255)
        if i == 2:
            soft_fill(img, (qx + 10, ry - 14, qx + qw - 10, ry + 24), 8,
                      p["violet_soft"], 255)
        draw_text(draw, (qx + 18, ry), prop, 12, p["muted"], mono=True)
        if values[i] is None:
            soft_fill(img, (qx + 18, ry + 12, qx + qw - 30, ry + 19), 3,
                      p["border2"], 190)
        else:
            soft_fill(img, (qx + 18, ry + 8, qx + 18 + 34, ry + 26), 9,
                      p["warn"] if i == 1 else p["violet"], 24)
            draw_text(draw, (qx + 26, ry + 23), values[i], 13,
                      p["warn"] if i == 1 else p["violet"])
    hairline(img, qx + 18, qy + 252, qx + qw - 18, qy + 252, p["border"], 200)
    draw_text(draw, (qx + 18, qy + 270), "NF-005 … NF-008", 11.5,
              p["faint"], mono=True)
    draw_text(draw, (qx + 18, qy + 289), "locator.column", 11.5,
              p["faint"], mono=True)

    # ---- result tags -----------------------------------------------------
    tag_y, tag_h = 452, 38
    tags = [
        (830, 178, text["tag1"], p["warn"], p["warn_soft"], False),
        (1014, 152, text["tag2"], p["info"], p["info_soft"], False),
        (1172, 188, text["tag3"], p["faint"], p["card2"], True),
    ]
    for tx, tw, label, colour, fill, dashed in tags:
        soft_shadow(img, (tx, tag_y, tx + tw, tag_y + tag_h), 12,
                    max(0, p["shadow_alpha"] - 18), blur=10, offset=(0, 6))
        card(img, (tx, tag_y, tx + tw, tag_y + tag_h), 12, fill, p["border"])
        if not dashed:
            dot(img, (tx + 13, tag_y + tag_h // 2), colour, 4)
        else:
            dot(img, (tx + 13, tag_y + tag_h // 2), p["faint"], 3)
        draw_text(draw, (tx + 24, tag_y + 24), label, 14, colour,
                  mono=True)
    draw_text(draw, (830, 520), text["caption"], 17, p["muted"])

    # overflow guard: fail loudly instead of shipping a clipped banner
    limits = [
        ("subtitle", 34, True, measure(text["subtitle"], 34, bold=True), 740),
        ("value1", 25, False, measure(text["value1"], 25), 730),
        ("value2", 25, False, measure(text["value2"], 25), 730),
        ("meta", 21, False, measure(text["meta"], 21), 740),
        ("footer", 18, False, measure(text["footer"], 18), 740),
        ("caption", 17, False, measure(text["caption"], 17), 530),
    ]
    for name, _size, _bold, width, limit in limits:
        if width > limit:
            print(f"WARN hero {lang}/{theme}: {name} width {width:.0f} > {limit}")
    return img


# ---------------------------------------------------------------------------
# flow SVG
# ---------------------------------------------------------------------------
FLOW = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        card="#ffffff", card2="#f6f8fd", panel="#ffffff",
        border="#d9deee", border2="#c8cfe4",
        ink="#1b2340", muted="#5f6884", faint="#8b94ad",
        accent="#4B67B4", soft="#eef1fb", accent_ink="#33477f",
        violet="#7A63B0", violet_soft="#f4f1fb",
        warn="#B45309", warn_soft="#fdf3e5",
        info="#3B6EA5", info_soft="#edf3fb",
        error="#B42318",
        track_a="#f2f5fc", track_c="#f2f5fc", track_b="#f6f3fc",
        shadow="#1f2a50", shadow_opacity="0.10",
        dot_opacity="0.30",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        card="#1a2233", card2="#202a40", panel="#1a2233",
        border="#2e3a55", border2="#3a4766",
        ink="#e9edf9", muted="#a2adc8", faint="#7b86a3",
        accent="#8496f5", soft="#202a44", accent_ink="#b9c4ff",
        violet="#a99be8", violet_soft="#262139",
        warn="#e3b25f", warn_soft="#33291a",
        info="#82b3e8", info_soft="#1d2b40",
        error="#f08a7a",
        track_a="#1d2740", track_c="#1d2740", track_b="#232038",
        shadow="#000000", shadow_opacity="0.45",
        dot_opacity="0.22",
    ),
}

SANS = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Segoe UI',sans-serif"
MONO = "'Consolas','SFMono-Regular','Menlo',monospace"


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def svg_text(x: float, y: float, value: str, size: float, fill: str,
             weight: int | None = None, mono: bool = False,
             anchor: str | None = None, tracking: float | None = None) -> str:
    attrs = [f'x="{x:g}"', f'y="{y:g}"', f'font-size="{size:g}"', f'fill="{fill}"']
    if weight:
        attrs.append(f'font-weight="{weight}"')
    attrs.append(f'font-family="{MONO if mono else SANS}"')
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if tracking:
        attrs.append(f'letter-spacing="{tracking:g}"')
    return f"<text {' '.join(attrs)}>{esc(value)}</text>"


def svg_rect(x: float, y: float, w: float, h: float, rx: float, fill: str,
             stroke: str | None = None, width: float = 1.2,
             dash: str | None = None, opacity: float | None = None,
             shadow: bool = False) -> str:
    attrs = [f'x="{x:g}"', f'y="{y:g}"', f'width="{w:g}"', f'height="{h:g}"',
             f'rx="{rx:g}"', f'fill="{fill}"']
    if stroke:
        attrs += [f'stroke="{stroke}"', f'stroke-width="{width:g}"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    if opacity is not None:
        attrs.append(f'opacity="{opacity:g}"')
    if shadow:
        attrs.append('filter="url(#soft)"')
    return f"<rect {' '.join(attrs)}/>"


def svg_line(x1: float, y1: float, x2: float, y2: float, color: str,
             width: float = 1, dash: str | None = None,
             opacity: float | None = None) -> str:
    attrs = [f'x1="{x1:g}"', f'y1="{y1:g}"', f'x2="{x2:g}"', f'y2="{y2:g}"',
             f'stroke="{color}"', f'stroke-width="{width:g}"',
             'stroke-linecap="round"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    if opacity is not None:
        attrs.append(f'opacity="{opacity:g}"')
    return f"<line {' '.join(attrs)}/>"


def svg_path(d: str, color: str, width: float = 1.4,
             dash: str | None = None, fill: str = "none") -> str:
    attrs = [f'd="{d}"', f'fill="{fill}"', f'stroke="{color}"',
             f'stroke-width="{width:g}"', 'stroke-linecap="round"',
             'stroke-linejoin="round"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    return f"<path {' '.join(attrs)}/>"


def svg_arrowhead(x: float, y: float, color: str, direction: str = "right") -> str:
    if direction == "right":
        d = f"M{x - 8:g} {y - 5:g} L{x:g} {y:g} L{x - 8:g} {y + 5:g}"
    elif direction == "down":
        d = f"M{x - 5:g} {y - 8:g} L{x:g} {y:g} L{x + 5:g} {y - 8:g}"
    else:
        d = f"M{x + 8:g} {y - 5:g} L{x:g} {y:g} L{x + 8:g} {y + 5:g}"
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8" '
            'stroke-linecap="round" stroke-linejoin="round"/>')


def svg_chip(x: float, y: float, w: float, h: float, label: str, fill: str,
             stroke: str | None, color: str, size: float = 16.5,
             dash: str | None = None) -> str:
    out = [svg_rect(x, y, w, h, 8, fill, stroke, 1.1, dash)]
    out.append(svg_text(x + w / 2, y + h / 2 + size * 0.36, label, size, color,
                        anchor="middle", mono=True))
    return "".join(out)


def flow_svg(theme: str) -> str:
    p = FLOW[theme]
    W, H = 1100, 660
    out: list[str] = []
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" '
        f'aria-label="dsh-nsfc-form-check structure: body lines and document properties '
        f'through a roster gate and three rule tracks into issues and skipped">'
    )
    out.append("<title>dsh-nsfc-form-check: two channels, three rule tracks, two lists</title>")
    out.append("<defs>")
    out.append(
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{p["bg1"]}"/>'
        f'<stop offset="1" stop-color="{p["bg2"]}"/></linearGradient>'
    )
    out.append(
        f'<radialGradient id="glow" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0" stop-color="{p["accent"]}" stop-opacity="0.13"/>'
        f'<stop offset="1" stop-color="{p["accent"]}" stop-opacity="0"/></radialGradient>'
    )
    out.append(
        f'<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">'
        f'<circle cx="1.4" cy="1.4" r="1.4" fill="{p["faint"]}"/></pattern>'
    )
    out.append(
        f'<filter id="soft" x="-15%" y="-15%" width="130%" height="140%">'
        f'<feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="{p["shadow"]}" '
        f'flood-opacity="{p["shadow_opacity"]}"/></filter>'
    )
    out.append("</defs>")

    out.append(svg_rect(0, 0, W, H, 22, "url(#bg)"))
    out.append(svg_rect(0, 0, W, H, 22, "url(#dots)", opacity=float(p["dot_opacity"])))
    out.append(f'<circle cx="1000" cy="60" r="330" fill="url(#glow)"/>')
    out.append(f'<circle cx="70" cy="630" r="250" fill="url(#glow)" opacity="0.6"/>')

    # header -------------------------------------------------------------
    out.append(svg_text(44, 52, "DSH-NSFC-FORM-CHECK · RULESET 2026.1 · 15 RULES",
                        14.5, p["accent"], weight=700, mono=True, tracking=1.6))
    out.append(svg_text(44, 94, "Two channels in. Two lists out.", 32,
                        p["ink"], weight=700))
    out.append(svg_text(44, 122,
                        "Body lines and document properties on three rule tracks; "
                        "every check that could not run is named in skipped.",
                        16, p["muted"]))
    out.append(svg_line(44, 140, 1056, 140, p["border"], 1))

    # roster gate --------------------------------------------------------
    out.append(svg_rect(44, 154, 704, 60, 14, p["soft"], p["accent"], 1.4,
                        "7 5", opacity=0.95, shadow=True))
    out.append(svg_rect(60, 172, 46, 20, 6, p["accent"]))
    out.append(svg_text(83, 186.5, "GATE", 11.5, p["card"], weight=700,
                        mono=True, anchor="middle"))
    out.append(svg_text(118, 180, "INSTITUTION ROSTER · NF-001", 15.5,
                        p["accent_ink"], weight=700))
    out.append(svg_text(118, 201, "author / institution / advisor / allowList",
                        14, p["muted"], mono=True))
    out.append(svg_text(730, 180, "empty roster → warn", 14, p["warn"],
                        mono=True, anchor="end"))
    out.append(svg_text(730, 201, "dependents → skipped", 14, p["muted"],
                        mono=True, anchor="end"))
    out.append(svg_path("M396 214 V230", p["accent"], 1.4, "4 4"))
    out.append(svg_arrowhead(396, 230, p["accent"], "down"))

    # material card ------------------------------------------------------
    out.append(svg_rect(44, 232, 272, 328, 18, p["card"], p["border"], 1.2,
                        shadow=True))
    out.append(svg_rect(60, 246, 28, 28, 8, p["soft"], p["border"], 1.1))
    for i, width in enumerate((14, 10, 14)):
        out.append(svg_line(68, 254 + i * 6, 68 + width, 254 + i * 6,
                            p["accent"], 2))
    out.append(svg_text(98, 265, "MATERIAL", 17, p["ink"], weight=700))
    out.append(svg_rect(224, 248, 84, 22, 7, p["soft"], p["border"], 1))
    out.append(svg_text(266, 263.5, "parse.ts", 14, p["accent"], mono=True,
                        anchor="middle"))
    out.append(svg_text(60, 292, ".docx/.json/.txt/.md/.yaml", 14,
                        p["muted"], mono=True))
    out.append(svg_line(60, 302, 300, 302, p["border"], 1))

    # body channel
    out.append(svg_text(60, 326, "BODY LINES", 17, p["accent_ink"], weight=700))
    out.append(svg_text(300, 326, "lines[]", 14, p["accent"], mono=True,
                        anchor="end"))
    rows = [(346, 154, None), (360, 116, None), (374, 94, "term"),
            (388, 172, None)]
    for i, (ry, bw, kind) in enumerate(rows, start=1):
        colour = p["faint"]
        if kind:
            out.append(svg_rect(54, ry - 9, 246, 20, 6, p["warn_soft"], None))
            colour = p["warn"]
        out.append(svg_text(78, ry + 4, f"{i:02d}", 12, colour, mono=True,
                            anchor="end"))
        out.append(svg_rect(88, ry - 3.5, bw, 7, 3.5, p["border2"]))
        if kind:
            tw = 54
            out.append(svg_rect(88 + bw + 6, ry - 9, tw, 18, 9,
                                p["warn_soft"], p["warn"], 1))
            out.append(svg_text(88 + bw + 6 + tw / 2, ry + 3.5, "term", 11,
                                p["warn"], mono=True, anchor="middle"))
    out.append(svg_text(60, 408, "line by line · locator.line", 14,
                        p["muted"], mono=True))
    out.append(svg_line(60, 420, 300, 420, p["border"], 1))

    # property channel
    out.append(svg_text(60, 434, "PROPERTIES", 17, p["violet"],
                        weight=700))
    out.append(svg_text(300, 434, "metadata", 14, p["violet"], mono=True,
                        anchor="end"))
    props = ["title", "author", "company", "lastModifiedBy"]
    for i, prop in enumerate(props):
        ry = 458 + i * 22
        if i == 1:
            out.append(svg_rect(54, ry - 12, 246, 19, 5, p["warn_soft"], None))
        if i == 2:
            out.append(svg_rect(54, ry - 12, 246, 19, 5, p["violet_soft"], None))
        out.append(svg_text(60, ry, prop, 16.5, p["muted"], mono=True))
        out.append(svg_rect(232, ry - 8, 68, 8, 4, p["border2"]))
    out.append(svg_text(60, 544, "field by field · locator.column", 14,
                        p["muted"], mono=True))

    # check core ---------------------------------------------------------
    out.append(svg_rect(328, 232, 432, 328, 18, p["panel"], p["border"], 1.2,
                        shadow=True))
    out.append(svg_text(348, 262, "CHECK CORE", 17, p["ink"], weight=700))
    out.append(svg_text(348, 282, "check.ts", 14, p["faint"], mono=True))
    out.append(svg_text(740, 262, "15 rules", 14, p["accent"], mono=True,
                        anchor="end"))
    out.append(svg_text(740, 282, "NF-001 … NF-015", 14, p["faint"], mono=True,
                        anchor="end"))
    out.append(svg_line(348, 292, 740, 292, p["border"], 1))

    tracks = [
        dict(y=300, title="BODY · IDENTITY", tag="lines[]",
             accent=p["accent"], fill=p["track_a"],
             sub="line literal match; NF-014 asks for presence",
             rules=["NF-002", "NF-003", "NF-004", "NF-013", "NF-014"]),
        dict(y=390, title="POLICY · SCOPE", tag="lines[] + params",
             accent=p["accent"], fill=p["track_c"],
             sub="windows · limits · items · disclosure · terms",
             rules=["NF-009", "NF-010", "NF-011", "NF-012", "NF-015"]),
        dict(y=480, title="PROPERTIES · IDENTITY", tag="metadata",
             accent=p["violet"], fill=p["track_b"],
             sub="field-level match; one entry per property",
             rules=["NF-005", "NF-006", "NF-007", "NF-008"]),
    ]
    for track in tracks:
        y = track["y"]
        out.append(svg_rect(344, y, 400, 82, 13, track["fill"], p["border"], 1.1))
        out.append(svg_rect(352, y + 12, 4, 58, 2, track["accent"]))
        out.append(svg_text(368, y + 24, track["title"], 17, p["ink"],
                            weight=700))
        tag_w = 18 + 8.4 * len(track["tag"])
        out.append(svg_rect(740 - tag_w, y + 8, tag_w, 22, 7, p["soft"],
                            p["border"], 1))
        out.append(svg_text(740 - tag_w / 2, y + 23.5, track["tag"], 14,
                            track["accent"], mono=True, anchor="middle"))
        out.append(svg_text(368, y + 44, track["sub"], 14, p["muted"]))
        for i, rule in enumerate(track["rules"]):
            cx = 368 + i * 75
            out.append(svg_chip(cx, y + 52, 68, 24, rule, p["soft"],
                                p["border"], track["accent"], 16.5))

    # channel connectors
    out.append(svg_path("M316 352 H326 V341 H340", p["accent"], 1.6))
    out.append(svg_arrowhead(340, 341, p["accent"]))
    out.append(svg_path("M326 352 V431 H340", p["accent"], 1.6))
    out.append(svg_arrowhead(340, 431, p["accent"]))
    out.append(svg_path("M316 493 C332 493 330 520 340 520", p["violet"], 1.6))
    out.append(svg_arrowhead(340, 520, p["violet"]))

    # report trays -------------------------------------------------------
    out.append(svg_rect(784, 232, 272, 156, 18, p["card"], p["border"], 1.2,
                        shadow=True))
    out.append(svg_text(802, 260, "ISSUES[]", 17, p["accent"], weight=700,
                        mono=True))
    out.append(svg_text(802, 280, "one entry per difference", 14, p["muted"]))
    out.append(svg_line(802, 290, 1038, 290, p["border"], 1))
    legend = [(802, p["error"], "error"), (872, p["warn"], "warn"),
              (934, p["info"], "info")]
    for lx, colour, label in legend:
        out.append(f'<circle cx="{lx + 4}" cy="{306}" r="3.6" fill="{colour}"/>')
        out.append(svg_text(lx + 13, 311, label, 14, p["muted"], mono=True))
    out.append(f'<circle cx="806" cy="330" r="3.6" fill="{p["warn"]}"/>')
    out.append(svg_text(816, 335, "NF-002 · line 04", 15, p["ink"], mono=True))
    out.append(f'<circle cx="806" cy="352" r="3.6" fill="{p["info"]}"/>')
    out.append(svg_text(816, 357, "NF-006 · author", 15, p["ink"], mono=True))
    out.append(svg_text(802, 376, "each names its clause & kind", 14,
                        p["faint"]))

    out.append(svg_rect(784, 396, 272, 164, 18, p["card"], p["border"], 1.2,
                        "5 4", shadow=True))
    out.append(svg_text(802, 424, "SKIPPED[]", 17, p["muted"], weight=700,
                        mono=True))
    out.append(svg_text(802, 444, "one reason per rule", 14, p["muted"]))
    out.append(svg_line(802, 454, 1038, 454, p["border"], 1))
    out.append(f'<circle cx="806" cy="474" r="3.6" fill="{p["faint"]}"/>')
    out.append(svg_text(816, 479, "NF-010 · maxLines unset", 15, p["ink"],
                        mono=True))
    out.append(f'<circle cx="806" cy="496" r="3.6" fill="{p["faint"]}"/>')
    out.append(svg_text(816, 501, "NF-015 · secretTerms unset", 15, p["ink"],
                        mono=True))
    out.append(svg_text(802, 524, "disabled · unmet · no diff", 14,
                        p["faint"]))
    out.append(svg_text(802, 546, "empty issues ≠ a pass", 16, p["warn"],
                        weight=700))

    out.append(svg_text(784, 578, "view.ts → markdown · reportJson", 14,
                        p["faint"], mono=True))

    # report collector
    out.append(svg_path("M744 341 H768 V520 H780", p["muted"], 1.4))
    out.append(svg_path("M768 341 H780", p["muted"], 1.4))
    out.append(svg_arrowhead(782, 341, p["muted"], "right"))
    out.append(svg_arrowhead(782, 520, p["muted"], "right"))

    # basis-kind severity ruler -----------------------------------------
    out.append(svg_rect(44, 588, 1012, 44, 14, p["soft"], p["border"], 1.2))
    out.append(svg_text(64, 616, "BASIS KIND → SEVERITY CAP", 14,
                        p["accent_ink"], weight=700, mono=True))
    caps = [
        (300, 140, "direct ≤ error", p["ink"]),
        (452, 254, "derived-from-principle ≤ warn", p["warn"]),
        (718, 306, "institutional-configuration ≤ info", p["info"]),
    ]
    for cx, cw, label, colour in caps:
        out.append(svg_rect(cx, 598, cw, 24, 7, p["card"], p["border"], 1))
        out.append(svg_text(cx + cw / 2, 614, label, 14, colour, mono=True,
                            anchor="middle"))

    out.append("</svg>")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for theme in ("light", "dark"):
            img = hero(lang, theme)
            path = os.path.join(OUT, f"dsh-nsfc-form-check-hero-{lang}-{theme}.webp")
            img.save(path, "WEBP", quality=92, method=6)
            print(f"hero {lang:2s}/{theme:5s} -> {os.path.relpath(path, ROOT)} "
                  f"({img.width}x{img.height}, {os.path.getsize(path) // 1024} KiB)")
    for theme in ("light", "dark"):
        svg = flow_svg(theme)
        path = os.path.join(OUT, f"dsh-nsfc-form-check-flow-v5-{theme}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(svg)
        print(f"flow {theme:5s} -> {os.path.relpath(path, ROOT)} "
              f"({os.path.getsize(path) // 1024} KiB)")


if __name__ == "__main__":
    main()
