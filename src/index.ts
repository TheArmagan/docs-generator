import fs from "fs/promises";
import { existsSync } from "fs";
import { plsParseArgs } from "plsargs";
import path from "path";
import stuffs from "stuffs";
import yaml from "yaml";
import { JSDOM } from "jsdom";
const args = plsParseArgs(process.argv.slice(2));

type CategoryConfig = {
  "display-name": Record<string, string>,
  icon: string
}

type Page = {
  title: Record<string, string>,
}

function getIconHTML(icon: string, size = 24) {
  if (icon.startsWith("assets://")) {
    return `<img class="icon" src="/~/assets/${icon.slice(9)}" alt="icon" height="${size}" />`;
  } else {
    return `<span class="material-symbols-outlined icon" style="font-size: ${size}px">${icon}</span>`;
  }
}

async function makeSureExist(p: string) {
  const parsed = path.parse(p);
  const d = parsed.dir;
  if (!existsSync(d)) await fs.mkdir(d, { recursive: true });
}

(async () => {
  const TEMPLATE_HTML = await fs.readFile(path.join(__dirname, "../templates/index.html"), "utf-8");
  const PROJECT_PATH = args.has("project") ? path.resolve(args.get("project")) : path.join(__dirname, "../project");
  const OUT_PATH = args.has("out") ? path.resolve(args.get("out")) : path.join(__dirname, "../out");

  await makeSureExist(PROJECT_PATH);

  if (existsSync(OUT_PATH)) {
    await Promise.all((await fs.readdir(OUT_PATH)).map(async (f) => {
      await fs.rm(path.join(OUT_PATH, f), { recursive: true });
    }));
  }
  await makeSureExist(OUT_PATH);

  const config = yaml.parse(await fs.readFile(path.join(PROJECT_PATH, "./config.yml"), "utf-8"));

  const categories = await Promise.all((await fs.readdir(path.join(PROJECT_PATH, "./docs"))).map(async (categoryFolderName) => {
    return {
      pages: await Promise.all((await fs.readdir(path.join(PROJECT_PATH, "./docs", categoryFolderName))).filter(f => f.endsWith(".html")).map(async (pageFileName) => {
        const { window } = new JSDOM(await fs.readFile(path.join(PROJECT_PATH, "./docs", categoryFolderName, pageFileName), "utf-8"));
        const document = window.document;
        const sections = [...document.querySelectorAll("section")].map(section => {
          return [
            section.getAttribute("lang") || config.languages.default,
            section.innerHTML // TODO: parse all the stuff
          ]
        });
        return {
          title: Object.fromEntries([...document.head.querySelectorAll("title")].map(i => [i.getAttribute("lang") || config.languages.default, i.textContent.trim()])),
          sections,
          id: pageFileName.slice(0, -5)
        }
      })),
      config: yaml.parse(await fs.readFile(path.join(PROJECT_PATH, "./docs", categoryFolderName, "./category.yml"), "utf-8")) as CategoryConfig,
      id: categoryFolderName
    }
  }));

  const buttonsHTML = config.links.map(link => {
    return `<a class="button" title="${link.name}" href="${link.url}">
      ${getIconHTML(link.icon, 24)}
    </a>`
  }).join("\n");

  await Promise.all(
    config.languages.supported.map(async (langCode) => {
      const langFilePath = path.join(OUT_PATH, langCode, "index.html");
      await makeSureExist(langFilePath);
      await fs.writeFile(
        langFilePath,
        `<html><head><meta http-equiv="refresh" content="0; url=/${langCode}/${config["start-page"]}" /></head></html>`
      );
      await Promise.all(categories.map(async (cat) => {
        const catDisplayName = cat.config["display-name"][langCode] || cat.config["display-name"][config.languages.default];
        await Promise.all(cat.pages.map(async (page) => {
          const pageFilePath = path.join(OUT_PATH, `${langCode}/${cat.id}/${page.id}/index.html`);
          await makeSureExist(pageFilePath);
          await fs.writeFile(
            pageFilePath,
            stuffs.mapReplace(TEMPLATE_HTML, {
              "%app.sections%": categories.map(c => {
                return `
                <div class="section">
                  <a class="head${c.id === cat.id ? " active" : ""}" href="/${langCode}/${c.id}/${c.pages[0].id}">
                    <div class="name-container">
                      ${c.config.icon ? getIconHTML(c.config.icon, 20) : ""}
                      <div class="name">${catDisplayName}</div>
                    </div>
                    <span class="material-symbols-outlined icon">expand_more</span>
                  </a>
                  <div class="contents${c.id === cat.id ? " visible" : ""}">
                    ${c.pages.map(p => {
                  return `<a ${(c.id + p.id === cat.id + page.id) ? `class="active" ` : ""}href="/${langCode}/${c.id}/${p.id}">${p.title[langCode] || p.title[config.languages.default]}</a>`;
                }).join("\n")}
                    </div>
                </div>
                `
              }).join("\n"),
              "%app.history%": [
                langCode, cat.id, page.id
              ].filter(Boolean).map((curr, idx, all) => {
                return `
                 <div class="slash">/</div>
                 <a class="name" href="/${all.slice(0, idx + 1).join("/")}">${curr}</a>
                `
              }).join("\n"),
              "%app.nav_buttons%": buttonsHTML,
              "%head.title%": `${catDisplayName} - ${page.title[langCode] || page.title[config.languages.default]}`,
              "%head.other%": "",
              "%app.lang%": langCode,
              "%app.next_lang%": config.languages.supported[(config.languages.supported.indexOf(langCode) + 1) % config.languages.supported.length],
            })
          )
          await Promise.all(page.sections.map(async (section) => {

          }))
        }));
      }));
    })
  );

  await makeSureExist(path.join(OUT_PATH, "./~/assets"));
  await fs.cp(path.join(__dirname, "../templates/index.js"), path.join(OUT_PATH, "./~/index.js"));
  await fs.cp(path.join(__dirname, "../templates/index.css"), path.join(OUT_PATH, "./~/index.css"));
  await fs.cp(path.join(PROJECT_PATH, "assets"), path.join(OUT_PATH, "./~/assets"), { recursive: true });
  await fs.writeFile(
    path.join(OUT_PATH, "index.html"),
    `<html><head><meta http-equiv="refresh" content="0; url=/${config.languages.default}/${config["start-page"]}" /></head></html>`
  );
})();