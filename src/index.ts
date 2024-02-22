import fs from "fs/promises";
import { existsSync } from "fs";
import { plsParseArgs } from "plsargs";
import path from "path";
import stuffs from "stuffs";
import yaml from "yaml";
import { JSDOM } from "jsdom";
import beautify from "js-beautify";



const args = plsParseArgs(process.argv.slice(2));

type CategoryConfig = {
  "display-name": Record<string, string>,
  icon: string
}

type Page = {
  title: Record<string, string>,
}

function parseAssetPath(p: string) {
  if (p.startsWith("assets://")) {
    return `/~/assets/${p.slice(9)}`;
  } else {
    return p;
  }
}

function getIconHTML(icon: string, size = 24) {
  if (icon.startsWith("assets://")) {
    return `<img class="icon" src="/~/assets/${icon.slice(9)}" alt="icon" height="${size}" />`;
  } else {
    return `<span class="material-symbols-outlined icon" style="font-size: ${size}px">${icon}</span>`;
  }
}

function formatCSS(css: string) {
  return beautify.css_beautify(css, {
    indent_size: 2,
  })
}

function formatHTML(t: string) {
  return beautify.html_beautify(t, {
    indent_size: 2,
  })
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

  const { window } = new JSDOM();
  const domParser = new window.DOMParser();

  const styleTexts: string[] = [];
  const components = Object.fromEntries(
    await Promise.all((await fs.readdir(path.join(PROJECT_PATH, "./components"))).map(async (componentFileName) => {
      const content = await fs.readFile(path.join(PROJECT_PATH, "./components", componentFileName), "utf-8");
      let styleAdded = false;
      let styleMap: Record<string, string> = {};
      return [
        componentFileName.slice(0, -5),
        (slotContent: any[]) => {
          const document = domParser.parseFromString(
            content,
            "text/html"
          );
          const slot = document.querySelector("slot");
          if (slot) {
            if (slotContent.length) {
              slot.replaceWith(...slotContent);
            } else {
              if (slot.childNodes.length) {
                slot.replaceWith(...slot.childNodes);
              } else {
                slot.remove();
              }
            }
          }
          if (!styleAdded) {
            styleAdded = true;
            let style = document.querySelector("style")?.textContent || "";
            if (style) {
              let classeLines = [...(style.match(/\.[^ ;]+.*[^;]\n/g) || [])];
              let classes = classeLines
                .map(cs => [...(cs.match(/\.[^ >.&#\[]+/) || [])])
                .flat(1);

              for (const className of classes) {
                let replaceName = `${className}-${Math.random().toString(33).slice(2, -4)}`;
                for (const classLine of classeLines) {
                  const nClassLine = classLine.replaceAll(className, replaceName);
                  if (nClassLine !== classLine) {
                    style = style.replaceAll(classLine, nClassLine);
                  }
                }
              styleMap[className] = replaceName;
            }
              styleTexts.push(style);
            }
          }

          let innerHTML = document.body.innerHTML;

          for (const [className, nClassName] of Object.entries(styleMap)) {
            innerHTML = innerHTML.replaceAll(/class="[^"]+"/g, (line) => {
              return line.replaceAll(className.slice(1), nClassName.slice(1))
            })
          }

          document.body.innerHTML = innerHTML;

          return [...document.body.childNodes].filter(i => i.nodeName !== "STYLE");
        }
      ]
    }))
  );

  const categories = await Promise.all((await fs.readdir(path.join(PROJECT_PATH, "./docs"))).map(async (categoryFolderName) => {
    return {
      pages: await Promise.all((await fs.readdir(path.join(PROJECT_PATH, "./docs", categoryFolderName))).filter(f => f.endsWith(".html")).map(async (pageFileName) => {
        const document = domParser.parseFromString(
          await fs.readFile(path.join(PROJECT_PATH, "./docs", categoryFolderName, pageFileName), "utf-8"),
          "text/html"
        );

        document.querySelectorAll("component").forEach((component) => {
          const name = component.getAttribute("name");
          component.replaceWith(...components[name]([...component.childNodes]));
        });

        const sections = Object.fromEntries(
          [...document.querySelectorAll("section")].map(section => {
            return [
              section.getAttribute("lang") || config.languages.default,
              section.innerHTML
            ]
          })
        );
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

  const headOther: string[] = [];

  headOther.push(
    `<style id="dg--component-styles">${formatCSS(styleTexts.join("\n"))}</style>`,
  );

  await Promise.all(
    config.languages.supported.map(async (langCode) => {
      const langFilePath = path.join(OUT_PATH, langCode, "index.html");
      await makeSureExist(langFilePath);
      await fs.writeFile(
        langFilePath,
        formatHTML(`<html><head><meta http-equiv="refresh" content="0; url=/${langCode}/${config["start-page"]}" /></head></html>`)
      );
      await Promise.all(categories.map(async (cat) => {
        const catFileName = path.join(OUT_PATH, langCode, cat.id, "index.html");
        await makeSureExist(catFileName);
        await fs.writeFile(
          catFileName,
          formatHTML(`<html><head><meta http-equiv="refresh" content="0; url=/${langCode}/${cat.id}/${cat.pages[0].id}" /></head></html>`)
        );
        const catDisplayName = cat.config["display-name"][langCode] || cat.config["display-name"][config.languages.default];
        await Promise.all(cat.pages.map(async (page) => {
          const pageFilePath = path.join(OUT_PATH, `${langCode}/${cat.id}/${page.id}/index.html`);
          await makeSureExist(pageFilePath);
          const sectionHTML = page.sections[langCode];
          await fs.writeFile(
            pageFilePath,
            formatHTML(stuffs.mapReplace(TEMPLATE_HTML, {
              "%app.sections%": categories.map(c => {
                return `
                <div class="section">
                  <a class="head${c.id === cat.id ? " active" : ""}" href="/${langCode}/${c.id}/${c.pages[0].id}">
                    <div class="name-container">
                      ${c.config.icon ? getIconHTML(c.config.icon, 20) : ""}
                      <div class="name">${c.config["display-name"][langCode] || c.config["display-name"][config.languages.default]}</div>
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
              "%head.other%": headOther.join("\n"),
              "%app.content%": sectionHTML || "",
              "%app.current_path%": `${cat.id}/${page.id}`,
              "%app.lang%": langCode,
              "%app.next_lang%": config.languages.supported[(config.languages.supported.indexOf(langCode) + 1) % config.languages.supported.length],
              "%head.icon%": config.icon ? parseAssetPath(config.icon) : "",
            }))
          )
          // await Promise.all(page.sections.map(async (section) => {

          // }))
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
    formatHTML(`<html><head><meta http-equiv="refresh" content="0; url=/${config.languages.default}/${config["start-page"]}" /></head></html>`)
  );
})();