// Demo store catalog per region. Commission rates are sample values for the demo, not quoted program rates.
const s = (name, program, network, commission, domains, tagLabel, sampleTag, tagParam = null) =>
  ({ name, program, network, commission, domains, tagLabel, sampleTag, tagParam });

const url = (host, path) => `https://${host}/${path}`;

export const REGIONS = {
  us: {
    label: 'United States', currency: 'USD', locale: 'en-US', orderRange: [20, 250],
    stores: {
      amazon:  s('Amazon', 'Amazon Associates', 'Direct', 0.04, ['amazon.com', 'amzn.to'], 'Associates tracking ID', 'creator-20', 'tag'),
      bestbuy: s('Best Buy', 'Best Buy Affiliate', 'Impact', 0.05, ['bestbuy.com', 'bby.us'], 'Impact partner ID', 'IR-2841907'),
      target:  s('Target', 'Target Partners', 'Impact', 0.06, ['target.com', 'goto.target.com'], 'Impact partner ID', 'IR-7730215'),
      walmart: s('Walmart', 'Walmart Creator', 'Impact', 0.045, ['walmart.com', 'goto.walmart.com'], 'Impact partner ID', 'IR-5518842'),
      bh:      s('B&H Photo', 'B&H Affiliate', 'CJ', 0.07, ['bhphotovideo.com'], 'CJ publisher ID', 'CJ-100482'),
      ebay:    s('eBay', 'eBay Partner Network', 'Direct', 0.03, ['ebay.com', 'ebay.us'], 'Campaign ID', '5339012345'),
    },
    seed: [
      { title: 'Arc desk lamp', slug: 'arc-lamp', stores: [
        { id: 'amazon', url: url('www.amazon.com', 'dp/B0ARCLAMP1') },
        { id: 'target', url: url('www.target.com', 'p/arc-desk-lamp/-/A-90001') },
        { id: 'walmart', url: url('www.walmart.com', 'ip/arc-desk-lamp/90001') }] },
      { title: 'Vlog camera kit', slug: 'vlog-cam', stores: [
        { id: 'amazon', url: url('www.amazon.com', 'dp/B0VLOGCAM1') },
        { id: 'bestbuy', url: url('www.bestbuy.com', 'site/vlog-camera-kit/90002.p') },
        { id: 'bh', url: url('www.bhphotovideo.com', 'c/product/90002-REG/vlog_camera_kit.html') }] },
      { title: 'Podcast mic', slug: 'podcast-mic', stores: [
        { id: 'amazon', url: url('www.amazon.com', 'dp/B0PODMIC01') },
        { id: 'bestbuy', url: url('www.bestbuy.com', 'site/podcast-mic/90003.p') },
        { id: 'bh', url: url('www.bhphotovideo.com', 'c/product/90003-REG/podcast_mic.html') },
        { id: 'walmart', url: url('www.walmart.com', 'ip/podcast-mic/90003') }] },
      { title: 'Ergonomic chair', slug: 'desk-chair', stores: [
        { id: 'amazon', url: url('www.amazon.com', 'dp/B0ERGOCHR1') },
        { id: 'target', url: url('www.target.com', 'p/ergonomic-chair/-/A-90004') },
        { id: 'walmart', url: url('www.walmart.com', 'ip/ergonomic-chair/90004') }] },
    ],
  },
  in: {
    label: 'India', currency: 'INR', locale: 'en-IN', orderRange: [499, 14999],
    stores: {
      amazonin: s('Amazon.in', 'Amazon Associates India', 'Direct', 0.05, ['amazon.in', 'amzn.in', 'amzn.to'], 'Associates tracking ID', 'creator-21', 'tag'),
      flipkart: s('Flipkart', 'Flipkart Affiliate', 'Direct', 0.06, ['flipkart.com', 'fkrt.it', 'fkrt.cc'], 'Affiliate ID', 'creatorfk', 'affid'),
      myntra:   s('Myntra', 'Myntra', 'Cuelinks', 0.08, ['myntra.com', 'myntr.it'], 'Cuelinks channel ID', 'CL-48213'),
      ajio:     s('Ajio', 'Ajio', 'Cuelinks', 0.09, ['ajio.com', 'ajiio.co'], 'Cuelinks channel ID', 'CL-48213'),
      croma:    s('Croma', 'Croma', 'Cuelinks', 0.03, ['croma.com'], 'Cuelinks channel ID', 'CL-48213'),
      reliance: s('Reliance Digital', 'Reliance Digital', 'Cuelinks', 0.03, ['reliancedigital.in'], 'Cuelinks channel ID', 'CL-48213'),
      nykaa:    s('Nykaa', 'Nykaa', 'Cuelinks', 0.07, ['nykaa.com', 'nykaafashion.com'], 'Cuelinks channel ID', 'CL-48213'),
    },
    seed: [
      { title: 'Wireless earbuds', slug: 'earbuds', stores: [
        { id: 'amazonin', url: url('www.amazon.in', 'dp/B0EARBUDS1') },
        { id: 'flipkart', url: url('www.flipkart.com', 'wireless-earbuds/p/itm90011') },
        { id: 'croma', url: url('www.croma.com', 'wireless-earbuds/p/90011') }] },
      { title: 'Fitness smartwatch', slug: 'smartwatch', stores: [
        { id: 'amazonin', url: url('www.amazon.in', 'dp/B0SMARTWT1') },
        { id: 'flipkart', url: url('www.flipkart.com', 'fitness-smartwatch/p/itm90012') },
        { id: 'myntra', url: url('www.myntra.com', 'smart-watches/90012/buy') },
        { id: 'reliance', url: url('www.reliancedigital.in', 'fitness-smartwatch/p/90012') }] },
      { title: 'Running shoes', slug: 'running-shoes', stores: [
        { id: 'myntra', url: url('www.myntra.com', 'sports-shoes/90013/buy') },
        { id: 'ajio', url: url('www.ajio.com', 'running-shoes/p/90013') },
        { id: 'flipkart', url: url('www.flipkart.com', 'running-shoes/p/itm90013') },
        { id: 'amazonin', url: url('www.amazon.in', 'dp/B0RUNSHOE1') }] },
      { title: 'Vitamin C serum', slug: 'vitc-serum', stores: [
        { id: 'nykaa', url: url('www.nykaa.com', 'vitamin-c-serum/p/90014') },
        { id: 'amazonin', url: url('www.amazon.in', 'dp/B0VITCSRM1') },
        { id: 'flipkart', url: url('www.flipkart.com', 'vitamin-c-serum/p/itm90014') }] },
    ],
  },
};
