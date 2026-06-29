// Inicialização do Supabase Client
let supabaseClient;

try {
    if (typeof window.CONFIG === 'undefined' || !window.CONFIG.SUPABASE_URL || !window.CONFIG.SUPABASE_ANON_KEY) {
        throw new Error("Credenciais do Supabase não configuradas no arquivo config.js.");
    }
    
    supabaseClient = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
} catch (error) {
    console.error("Erro ao inicializar o Supabase:", error);
    showErrorAlert("Erro de inicialização: configure corretamente o arquivo config.js.");
}

// Elementos do DOM
const guessForm = document.getElementById('guess-form');
const goalsBrazilInput = document.getElementById('goals-brazil');
const goalsJapanInput = document.getElementById('goals-japan');
const participantNameInput = document.getElementById('participant-name');
const btnSubmit = document.getElementById('btn-submit');
const guessesList = document.getElementById('guesses-list');

// Elementos de Estatísticas
const statTotal = document.getElementById('stat-total');
const statAvgBrazil = document.getElementById('stat-avg-brazil');
const statAvgJapan = document.getElementById('stat-avg-japan');

// Elementos de Alerta
const alertSuccess = document.getElementById('alert-success');
const alertError = document.getElementById('alert-error');
const alertInfo = document.getElementById('alert-info');

// Limite para palpites: 29 de Junho de 2026 às 13:55:00 (Fuso Horário de Brasília -03:00)
const LIMITE_PALPITES = new Date('2026-06-29T13:55:00-03:00');

function verificarLimiteTempo() {
    const agora = new Date();
    if (agora >= LIMITE_PALPITES) {
        // Desabilitar formulário
        const inputs = guessForm.querySelectorAll('input');
        inputs.forEach(input => input.disabled = true);
        btnSubmit.disabled = true;
        btnSubmit.querySelector('span').textContent = 'Palpites Encerrados 🔒';
        btnSubmit.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
        btnSubmit.style.color = '#9ca3af';
        btnSubmit.style.boxShadow = 'none';
        
        showInfoAlert("O prazo para palpites encerrou às 13:55 (5 minutos antes do jogo). Boa sorte!");
        return true;
    }
    return false;
}

// Iniciar a aplicação
document.addEventListener('DOMContentLoaded', () => {
    if (supabaseClient) {
        loadGuesses();
        setupRealtimeSubscription();
        verificarLimiteTempo();
        // Verificar limite a cada 10 segundos para travar em tempo real se o usuário estiver com a página aberta
        setInterval(verificarLimiteTempo, 10000);
    }
});

// Registrar o palpite
guessForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Verificar se já passou do limite de tempo
    if (verificarLimiteTempo()) {
        return;
    }
    
    // Obter dados do formulário
    const nome = participantNameInput.value.trim();
    const golsBrasil = parseInt(goalsBrazilInput.value, 10);
    const golsJapao = parseInt(goalsJapanInput.value, 10);
    
    if (!nome || isNaN(golsBrasil) || isNaN(golsJapao)) {
        showErrorAlert("Por favor, preencha todos os campos corretamente.");
        return;
    }
    
    // Entrar em estado de loading
    setLoadingState(true);
    hideAlerts();
    
    try {
        // Inserir dados no Supabase
        const { data, error } = await supabaseClient
            .from('palpites')
            .insert([
                { 
                    nome: nome, 
                    gols_brasil: golsBrasil, 
                    gols_japao: golsJapao 
                }
            ]);
            
        if (error) throw error;
        
        // Sucesso
        showSuccessAlert(`Palpite de ${nome} salvo com sucesso!`);
        guessForm.reset();
        
        // Recarregar os palpites localmente
        await loadGuesses();
        
    } catch (error) {
        console.error("Erro ao salvar palpite:", error);
        showErrorAlert(error.message || "Erro ao salvar palpite no banco de dados. Verifique a tabela no Supabase.");
    } finally {
        setLoadingState(false);
    }
});

// Buscar palpites no banco
async function loadGuesses() {
    try {
        const { data, error } = await supabaseClient
            .from('palpites')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        renderGuesses(data);
        updateStatistics(data);
    } catch (error) {
        console.error("Erro ao carregar palpites:", error);
        guessesList.innerHTML = `<div class="empty-state" style="color: #f87171;">Erro ao carregar palpites. Verifique se a tabela 'palpites' foi criada.</div>`;
    }
}

// Configurar inscrição em tempo real (Realtime)
function setupRealtimeSubscription() {
    try {
        supabaseClient
            .channel('schema-db-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'palpites'
                },
                (payload) => {
                    console.log('Alteração detectada em tempo real:', payload);
                    loadGuesses(); // Recarrega os dados quando houver mudanças
                }
            )
            .subscribe();
    } catch (e) {
        console.warn("Realtime não pôde ser ativado:", e);
    }
}

// Renderizar lista de palpites
function renderGuesses(guesses) {
    if (!guesses || guesses.length === 0) {
        guessesList.innerHTML = `<div class="empty-state">Nenhum palpite enviado ainda. Seja o primeiro! 🏆</div>`;
        return;
    }
    
    guessesList.innerHTML = guesses.map(guess => {
        const date = new Date(guess.created_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <div class="guess-card">
                <div class="guess-info">
                    <span class="guess-name">${escapeHTML(guess.nome)}</span>
                    <span class="guess-date">Enviado em ${date}</span>
                </div>
                <div class="guess-score">
                    <span class="guess-score-num brazil">${guess.gols_brasil}</span>
                    <span class="guess-score-x">x</span>
                    <span class="guess-score-num japan">${guess.gols_japao}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Atualizar o painel de estatísticas
function updateStatistics(guesses) {
    if (!guesses || guesses.length === 0) {
        statTotal.textContent = "0";
        statAvgBrazil.textContent = "0";
        statAvgJapan.textContent = "0";
        return;
    }
    
    const total = guesses.length;
    let sumBrazil = 0;
    let sumJapan = 0;
    
    guesses.forEach(g => {
        sumBrazil += g.gols_brasil;
        sumJapan += g.gols_japao;
    });
    
    const avgBrazil = (sumBrazil / total).toFixed(1);
    const avgJapan = (sumJapan / total).toFixed(1);
    
    statTotal.textContent = total;
    statAvgBrazil.textContent = avgBrazil;
    statAvgJapan.textContent = avgJapan;
}

// Controle de UI
function setLoadingState(isLoading) {
    if (isLoading) {
        btnSubmit.classList.add('loading');
        btnSubmit.disabled = true;
    } else {
        btnSubmit.classList.remove('loading');
        btnSubmit.disabled = false;
    }
}

function hideAlerts() {
    alertSuccess.style.display = 'none';
    alertError.style.display = 'none';
    alertInfo.style.display = 'none';
}

function showSuccessAlert(message) {
    alertSuccess.querySelector('.alert-message').textContent = message;
    alertSuccess.style.display = 'flex';
    setTimeout(() => {
        alertSuccess.style.display = 'none';
    }, 5000);
}

function showErrorAlert(message) {
    alertError.querySelector('.alert-message').textContent = message;
    alertError.style.display = 'flex';
}

function showInfoAlert(message) {
    alertInfo.querySelector('.alert-message').textContent = message;
    alertInfo.style.display = 'flex';
}

// Sanitizar entradas contra XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
