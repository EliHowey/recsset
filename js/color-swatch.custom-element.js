const template = document.createElement('template');
template.innerHTML = `
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none; }
        :host { display: block; }

        .swatch-background {
            height: 100%;
            padding: 1em;
            font-family: var(--font-stack-mono, monospace);
        }

        .name {
            font-weight: bold;
        }
    </style>
    <div class="swatch-background">
        <div class="name"></div>
        <div class="value"></div>
        <div class="contrast"></div>
    </div>
`;

/**
 * Cache of luminance values, to prevent calculating luminance more than once per RGB color.
 */
const LUMINANCES = {};

/**
 * Element that displays a given color as a background, and calculates its
 * contrast ratio with an appropriate foreground color.
 */
export class ColorSwatchElement extends HTMLElement {
    static get observedAttributes() {
        return ['color', 'name', 'contrast'];
    }

    /**
     * RGB color value used as the light foreground text color. The swatch will
     * use this color for text if its contrast is higher than that of `darkRGB`.
     */
    static get lightRGB() {
        return 'rgb(243, 244, 246)';
    }

    /**
     * RGB color value used as the dark foreground text color. The swatch will
     * use this color for text if its contrast is higher than that of `lightRGB`.
     */
    static get darkRGB() {
        return 'rgb(9, 10, 12)';
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(template.content.cloneNode(true));

        this._backgroundEl = this.shadowRoot.querySelector('.swatch-background');
        this._nameEl = this.shadowRoot.querySelector('.name');
        this._valueEl = this.shadowRoot.querySelector('.value');
        this._contrastEl = this.shadowRoot.querySelector('.contrast');
    }

    get color() {
        return this.getAttribute('color');
    }

    set color(value) {
        this.setAttribute('color', value);
    }

    get name() {
        return this.getAttribute('name') || '';
    }

    set name(value) {
        if (value) {
            this.setAttribute('name', value);
        } else {
            this.removeAttribute('name');
        }
    }

    get contrast() {
        return this.hasAttribute('contrast');
    }

    set contrast(value) {
        if (value !== null && value !== undefined) {
            this.setAttribute('contrast', '');
        } else {
            this.removeAttribute('contrast');
        }
    }

    connectedCallback() {
        this._contrastEl.hidden = !this.contrast;
    }

    attributeChangedCallback(name, oldValue, newValue) {
        switch (name) {
            case 'color':
                this._updateColorProperties();
                break;
            case 'name':
                this._nameEl.textContent = this.name;
                break;
            case 'contrast':
                this._contrastEl.hidden = !this.contrast;
                break;
        }
    }

    _updateColorProperties() {
        if (this.color) {
            this._backgroundEl.style.backgroundColor = this.color;
            this._valueEl.textContent = this.color.toLowerCase();

            // Read the color directly from the element, so the browser will take care of the RGB conversion.
            // This read requires style recalculation, so we have to schedule the call to avoid layout thrashing.
            requestAnimationFrame(() => {
                const rgbBackground = getComputedStyle(this._backgroundEl).backgroundColor;
                const darkContrast = this._getContrastRatio(rgbBackground, ColorSwatchElement.darkRGB);
                const lightContrast = this._getContrastRatio(rgbBackground, ColorSwatchElement.lightRGB);
                const displayContrast = Math.max(darkContrast, lightContrast).toFixed(2);

                if (darkContrast > lightContrast) {
                    this._backgroundEl.style.color = ColorSwatchElement.darkRGB;
                } else {
                    this._backgroundEl.style.color = ColorSwatchElement.lightRGB;
                }

                this._contrastEl.textContent = `${this._getWCAGContrastRating(displayContrast)} (${displayContrast}:1)`;
            });
        } else {
            this._backgroundEl.style.backgroundColor = ColorSwatchElement.lightRGB;
            this._backgroundEl.style.color = ColorSwatchElement.darkRGB;
            this._valueEl.textContent = 'No color';
            this._contrastEl.textContent = '';
        }
    }

    /**
     * Calculates the contrast ratio between the given colors, using the
     * [W3C definition](https://www.w3.org/TR/2008/REC-WCAG20-20081211/#contrast-ratiodef).
     *
     * @param {string} backgroundColor Background color, as a CSS `rgb()` value
     * @param {string} foregroundColor Foreground color, as a CSS `rgb()` value
     */
    _getContrastRatio(backgroundColor, foregroundColor) {
        const bgLuminance = this._getLuminance(backgroundColor);
        const fgLuminance = this._getLuminance(foregroundColor);
        const contrastRatio = (Math.max(bgLuminance, fgLuminance) + 0.05) / (Math.min(bgLuminance, fgLuminance) + 0.05);

        return contrastRatio;
    }

    /**
     * Calculates the relative luminance of the given CSS-formatted rgb() value, using the
     * [W3C definition](https://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef).
     *
     * @param {string} rgbColor CSS `rgb()` value
     */
    _getLuminance(rgbColor) {
        if (LUMINANCES[rgbColor]) {
            return LUMINANCES[rgbColor];
        }

        const channels = this._getRGBChannels(rgbColor);
        const [R, G, B] = channels.map((value) => {
            value /= 255;
            return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });

        const luminance = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        LUMINANCES[rgbColor] = luminance;

        return luminance;
    }

    /**
     * Splits a CSS-formatted `rgb()` value into an array of its corresponding `[R, G, B]` channels.
     *
     * @param {string} rgbString CSS `rgb()` value
     */
    _getRGBChannels(rgbString) {
        return rgbString
            .slice(4, -1)
            .split(',')
            .map((v) => v.trim());
    }

    /**
     * Returns the highest compliance rating for the given contrast ratio, as
     * determined by the WCAG Success Criteria for color contrast.
     *
     * - 1.4.3 Contrast (Minimum):  4.5:1 (3:1 for large text)
     * - 1.4.6 Contrast (Enhanced): 7:1 (4.5:1 for large text)
     * - 1.4.11 Non-text Contrast:  3:1
     *
     * @param {number} contrastRatio Contrast ratio between two colors
     */
    _getWCAGContrastRating(contrastRatio) {
        if (contrastRatio >= 7) {
            return 'AAA';
        } else if (contrastRatio >= 4.5) {
            return 'AA';
        } else if (contrastRatio >= 3) {
            return 'Large text or non-text only';
        } else {
            return 'Fail';
        }
    }
}

customElements.define('color-swatch', ColorSwatchElement);
