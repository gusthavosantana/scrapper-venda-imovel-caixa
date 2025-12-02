const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({
        headless: false,           // mude para true quando estiver funcionando
        defaultViewport: null,
        args: ['--no-sandbox', '--start-maximized']
    });

    const page = await browser.newPage();
    
    // Configurações importantes
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Acessando o site da Caixa...');
    await page.goto('https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });

    // === PASSO 1: Preencher Estado e Cidade ===
    const estado = 'RN';           // ← Mude aqui
    const cidade = 'Natal';    // ← Mude aqui

    console.log(`Selecionando estado ${estado} e cidade ${cidade}...`);

    await page.waitForSelector('#estado', { visible: true });
    await page.select('#estado', estado);
    await page.waitForTimeout(2000);

    await page.waitForSelector('#cidade', { visible: true });
    await page.select('#cidade', cidade);
    await page.waitForTimeout(2000);

    // === PASSO 2: Clicar em Próximo ===
    await page.click('#btnProximo');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // === PASSO 3: Na tela "Dados do imóvel", clicar em Próximo novamente ===
    await page.waitForSelector('#btnProximo', { visible: true });
    await page.click('#btnProximo');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // === PASSO 4: Esperar resultados aparecerem ===
    await page.waitForSelector('.resultado-imovel, .imovel-item', { timeout: 10000 });

    // Pegar todos os links de "Detalhe do Imóvel"
    const detalheLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href*="detalhe-imovel.asp"]').forEach(a => {
            if (a.textContent.trim().includes('Detalhe do Imóvel')) {
                const href = a.getAttribute('href');
                links.push(href.startsWith('http') ? href : 'https://venda-imoveis.caixa.gov.br/sistema/' + href);
            }
        });
        return links;
    });

    console.log(`Encontrados ${detalheLinks.length} imóveis. Iniciando coleta...`);

    const imoveis = [];

    for (let i = 0; i < detalheLinks.length; i++) {
        const link = detalheLinks[i];
        console.log(`Coletando imóvel ${i + 1}/${detalheLinks.length}: ${link}`);

        const detailPage = await browser.newPage();
        await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        try {
            await detailPage.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });

            const dados = await detailPage.evaluate(() => {
                const getText = (selector) => {
                    const el = document.querySelector(selector);
                    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
                };

                const getLabelValue = (labelText) => {
                    const label = Array.from(document.querySelectorAll('label')).find(l => 
                        l.textContent.trim().toLowerCase().includes(labelText.toLowerCase())
                    );
                    if (label) {
                        const parent = label.closest('div') || label.parentElement;
                        const sibling = parent ? parent.nextElementSibling : null;
                        return sibling ? sibling.textContent.trim().replace(/\s+/g, ' ') : '';
                    }
                    return '';
                };

                return {
                    titulo: document.querySelector('h1, .titulo-imovel, h2')?.textContent.trim() || '',
                    descricao: getText('.descricao-imovel') || getText('p') || '',
                    endereco: getLabelValue('Endereço') || getLabelValue('Localização'),
                    valorAvaliacao: getLabelValue('Valor de avaliação') || getLabelValue('Avaliação'),
                    valorMinimoVenda: getLabelValue('Valor mínimo de venda') || getLabelValue('Lance mínimo'),
                    tipoImovel: getLabelValue('Tipo de imóvel') || getLabelValue('Tipo'),
                    quartos: getLabelValue('Quartos') || getLabelValue('Dormitórios'),
                    garagem: getLabelValue('Vagas') || getLabelValue('Garagem'),
                    numeroImovel: getLabelValue('Número do imóvel') || getLabelValue('Código do imóvel'),
                    matriculas: getLabelValue('Matrícula') || '',
                    comarca: getLabelValue('Comarca'),
                    inscricaoImobiliaria: getLabelValue('Inscrição imobiliária') || getLabelValue('IPTU'),
                    areaTotal: getLabelValue('Área total') || getLabelValue('Área do terreno'),
                    areaPrivativa: getLabelValue('Área privativa') || getLabelValue('Área útil') || getLabelValue('Área construída'),
                    formasPagamento: getText('.formas-pagamento, .pagamento') || getLabelValue('Formas de pagamento'),
                    regrasDespesas: getText('.despesas, .regras-despesas') || getLabelValue('Despesas') || getLabelValue('Responsabilidade')
                };
            });

            dados.link = link;
            imoveis.push(dados);
            console.log(`✓ Coletado: ${dados.titulo || 'Sem título'}`);

            await detailPage.close();
        } catch (err) {
            console.log(`✗ Erro ao coletar ${link}: ${err.message}`);
            await detailPage.close();
        }

        // Delay para não ser bloqueado
        await page.waitForTimeout(3000 + Math.random() * 2000);
    }

    // === SALVAR RESULTADOS ===
    const fs = require('fs');
    const path = require('path');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `caixa_imoveis_${estado}_${cidade.replace(/ /g, '_')}_${timestamp}.json`;
    
    fs.writeFileSync(filename, JSON.stringify(imoveis, null, 2), 'utf-8');
    console.log(`\nConcluído! ${imoveis.length} imóveis salvos em ${filename}`);

    // Opcional: gerar CSV
    const csv = [
        Object.keys(imoveis[0] || {}).join(';'),
        ...imoveis.map(imovel => Object.values(imovel).map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    fs.writeFileSync(filename.replace('.json', '.csv'), csv, 'utf-8');
    console.log(`CSV salvo como ${filename.replace('.json', '.csv')}`);

    await browser.close();
})();