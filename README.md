# Da Silvano — Website

Website for Da Silvano, Italian delicatessen & catering in Middelburg, Zeeland.

## Stack

Single-page HTML/CSS/JS — no framework, no build step, no dependencies.
Fonts loaded from Google Fonts. Everything else is inline.

## Structure

```
dasilvano-website/
├── index.html          # Full website — all CSS and JS inline
├── README.md
└── assets/
    ├── images/         # Drop local image assets here if needed
    ├── css/            # Extract CSS here if you want to split it out
    └── js/             # Extract JS here if you want to split it out
```

## Video

The hero video is hosted on Higgsfield CDN. If you want to self-host it:
1. Download the video from Higgsfield
2. Place it in `/assets/video/hero.mp4`
3. Update the `<source src="...">` in `index.html`

## Deployment

**Vercel (recommended — free)**
```bash
npm i -g vercel
cd dasilvano-website
vercel
```

**Netlify**
Drag and drop the `dasilvano-website` folder to [netlify.com/drop](https://app.netlify.com/drop)

**GitHub Pages**
1. Push to GitHub
2. Go to Settings → Pages → Deploy from branch → main → / (root)
3. Site live at `https://yourusername.github.io/dasilvano-website`

## To update the buffet/catering background image

Replace the `background-image` URL in the catering section with your new image URL.
Search for `hf_20260607_193409_6998870f` in `index.html` to find it.

## Contact

Da Silvano · Lange Noordstraat 26 · 4331 AC Middelburg
info@dasilvano.nl · 06-20900900
