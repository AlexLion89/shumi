// Каталоги книг: адрес запроса и разбор ответа в общий вид
//   { src, id, title, authors: [], year, cover, pages, url }
// Общий для браузера и Worker. FantLab, Google и Open Library браузер спрашивает сам: CORS у них открыт,
// Cloudflare на пути нет (у Вики с мобильного он почти не отвечает). LitRes и Douban без CORS (proxy: true) —
// через посредника в Yandex Cloud (proxy/index.js), он же отдаёт обложки Douban, которые без своего Referer не грузятся.
// Настоящие ответы лежат образцами в tests/fixtures: сменит каталог формат — упадёт тест.

// Виды произведений FantLab, которые похожи на «книгу»; рецензии, статьи, микрорассказы и циклы
// (на полку ставят «Гарри Поттер и философский камень», а не «Гарри Поттер» целиком) не нужны.
const FANTLAB_TYPES = new Set(["novel", "story", "shortstory", "novella", "collection", "epic",
  "fairy-tale", "documental", "comix", "popular"]);

// Пересказы чужих книг, которыми LitRes забивает выдачу: «Ключевые идеи книги…», «Саммари…», «… Кратко».
const RETELLING = /^(ключевые идеи|саммари|краткое (содержание|изложение)|инфографика|конспект|обзор книги|summary|workbook)|\.\s*кратко$|\(краткое изложение\)/i;
// Google Books ещё и наборами: «Комплект книг», «комплект из 3 психологических триллеров».
const BUNDLE = /комплект|box set|boxed set/i;
// Обложка Google: адрес на https, без «загнутого уголка» (edge=curl) и крупнее (fife) — исходная 128 px мелковата.
const googleCover = links => {
  const u = links?.thumbnail ?? links?.smallThumbnail;
  return u ? u.replace(/^http:/, "https:").replace(/&edge=curl/, "") + "&fife=w400-h600" : null;
};
// То же в Open Library: пересказы, «Paperback - …» от случайных продавцов, наборы из нескольких книг.
const JUNK_EN = /^(summary|workbook|study guide|analysis of|paperback\s*[-–])|summary (and|review)|collection set/i;
// Сначала с обложкой: без неё в Open Library обычно дубли изданий и мусор. Порядок внутри групп — как у каталога.
const coverFirst = items => [...items.filter(b => b.cover), ...items.filter(b => !b.cover)];

// Посредник: функция shumi-proxy в Yandex Cloud (выкладка — tools/proxy-deploy.mjs).
export const PROXY = "https://functions.yandexcloud.net/d4efieb52ktma35trjc9";
export const viaProxy = url => `${PROXY}?u=${encodeURIComponent(url)}`;

const yearOf = s => { const m = /^(\d{4})/.exec(String(s ?? "")); return m ? Number(m[1]) : null; };
const names = s => String(s ?? "").split(/,\s*/).map(x => x.trim()).filter(Boolean);

// FantLab: номер издания живёт в адресе обложки — по нему число страниц (/edition) и обложки других изданий
// того же произведения (/work/<id>/extended). CORS у api.fantlab.ru открыт.
export const fantlabEdition = cover => Number(/fantlab\.ru\/images\/editions\/(?:big|small)\/(\d+)/.exec(cover ?? "")?.[1]) || null;
export const FANTLAB = {
  edition: id => `https://api.fantlab.ru/edition/${id}`,
  work: id => `https://api.fantlab.ru/work/${id}/extended`,
  cover: id => `https://fantlab.ru/images/editions/big/${id}`,
  pages: d => (Number(d?.pages) > 0 ? Number(d.pages) : null),
  // Издания произведения: сначала на русском, внутри — новые сверху.
  editions: d => Object.values(d?.editions_blocks ?? {}).flatMap(b => b?.list ?? [])
    .map(e => ({ id: e.edition_id, year: e.year ?? null, lang: e.lang ?? "", pages: Number(e.pages) > 0 ? Number(e.pages) : null,
      hasCover: Number(e.pic_num) > 0 }))   // pic_num — сколько картинок у издания; 0 — обложки нет
    .filter(e => e.id)
    .sort((a, b) => (a.lang === "русский" ? 0 : 1) - (b.lang === "русский" ? 0 : 1) || (b.year ?? 0) - (a.year ?? 0)),
};

// Недокументированный API, которым пользуется сам сайт LitRes: книги (text_book) и аудиокниги (audiobook) — один формат.
const litresUrl = type => q => `https://api.litres.ru/foundation/api/search?q=${encodeURIComponent(q)}&types=${type}&limit=12`;
const persons = (b, role) => (b.persons ?? []).filter(p => p.role === role).map(p => p.full_name).filter(Boolean);
const litresParse = (d, extra = () => ({})) => (d?.payload?.data ?? []).map(x => x.instance ?? x).filter(b => b?.id && b.title && !RETELLING.test(b.title)).map(b => ({
  src: "litres", id: String(b.id), title: b.title,
  authors: persons(b, "author"),
  year: yearOf(b.date_written_at),
  // cover_url — «/pub/c/cover/<id>.jpg», полный размер до полумегабайта; cover_200 — около 20 КБ.
  cover: b.cover_url ? "https://cdn.litres.ru" + b.cover_url.replace("/pub/c/cover/", "/pub/c/cover_200/") : null,
  pages: null,
  url: b.url ? "https://www.litres.ru" + b.url : null,
  ...extra(b),
}));

// Аудиокниги LitRes — точная ссылка в карточке книги из «Хочу» и «Читаю»; readers — кто читает.
export const LITRES_AUDIO = {
  proxy: true,
  url: litresUrl("audiobook"),
  parse: d => litresParse(d, b => ({ readers: persons(b, "reader") })),
};

// Douban: автор «紫金陈» или «[日] 东野圭吾» — страна в скобках перед именем не нужна; несколько — через « / ».
const doubanNames = s => String(s ?? "").split(/\s*\/\s*/).map(x => x.replace(/^[\[［(（【][^\]］)）】]{1,4}[\]］)）】]\s*/, "").trim()).filter(Boolean);

export const SOURCES = {
  litres: {
    proxy: true,
    url: litresUrl("text_book"),
    parse: d => litresParse(d),
  },

  // Douban — китайские книги с оригинальными обложками. Подсказки поиска сайта: до десятка книг и авторов (type «a»
  // — страница автора, не книга). Обложка в подсказке мелкая (s) — берём среднюю (m, ~30 КБ), через посредника.
  douban: {
    proxy: true,
    url: q => `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`,
    parse: d => (Array.isArray(d) ? d : []).filter(x => x?.type === "b" && x.id && x.title).map(x => ({
      src: "douban", id: String(x.id), title: x.title,
      authors: doubanNames(x.author_name),
      year: yearOf(x.year),
      cover: x.pic ? viaProxy(x.pic.replace("/view/subject/s/", "/view/subject/m/")) : null,
      pages: null,
      url: x.url || `https://book.douban.com/subject/${x.id}/`,
    })),
  },

  fantlab: {
    url: q => `https://api.fantlab.ru/search-works?q=${encodeURIComponent(q)}&page=1`,
    parse: d => ((Array.isArray(d) ? d : d?.matches) ?? []).filter(m => m?.work_id && FANTLAB_TYPES.has(m.name_eng)).map(m => {
      const pic = m.pic_edition_id || m.pic_edition_id_auto;
      return {
        src: "fantlab", id: String(m.work_id), title: m.rusname || m.name,
        authors: names(m.all_autor_rusname || m.autor_rusname),
        year: m.year || null,
        cover: pic ? `https://fantlab.ru/images/editions/big/${pic}` : null,
        pages: null,
        url: `https://fantlab.ru/work${m.work_id}`,
      };
    }),
  },

  // Google Books — русский нон-фикшн и селф-хелп, которых нет на FantLab (их же нашёл бы LitRes, но тот браузер
  // не пускает). CORS открыт; ключ — из config.json в shumi-data, ограничен сайтом и Books API.
  google: {
    url: (q, { googleKey } = {}) => `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=15&printType=books`
      + (googleKey ? `&key=${encodeURIComponent(googleKey)}` : ""),
    parse: d => (d?.items ?? []).map(i => ({ id: i.id, v: i.volumeInfo ?? {} }))
      .filter(({ id, v }) => id && v.title && !RETELLING.test(v.title) && !BUNDLE.test(`${v.title} ${v.subtitle ?? ""}`))
      .map(({ id, v }) => ({
        src: "google", id, title: v.title,
        authors: v.authors ?? [],
        year: yearOf(v.publishedDate),
        cover: googleCover(v.imageLinks),
        pages: v.pageCount > 0 ? v.pageCount : null,
        url: v.infoLink ? v.infoLink.replace(/^http:/, "https:") : null,
      })),
  },

  openlibrary: {
    url: q => `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12`
      + "&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median",
    parse: d => coverFirst((d?.docs ?? []).filter(x => x?.key && x.title && !JUNK_EN.test(x.title)).map(x => ({
      src: "openlibrary", id: x.key.replace("/works/", ""), title: x.title,
      authors: x.author_name ?? [],
      year: x.first_publish_year || null,
      cover: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : null,
      pages: x.number_of_pages_median || null,
      url: "https://openlibrary.org" + x.key,
    }))),
  },
};
