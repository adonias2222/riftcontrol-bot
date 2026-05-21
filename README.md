# ⚔️ RiftControl Bot

Bot de WhatsApp para guilda de **LoL: Wild Rift** com:

- Cadastro de membros
- XP
- Cargos automáticos
- Registro de partidas
- K/D/A e KDA automático
- Ranking
- Histórico de partidas
- Stats do jogador
- Banco online no Supabase
- Deploy via GitHub + Back4App Containers

---

## 1. Criar tabelas no Supabase

No Supabase:

```txt
SQL Editor → New Query
```

Cole e rode o conteúdo do arquivo:

```txt
sql/supabase.sql
```

---

## 2. Variáveis de ambiente

No Back4App, cadastre:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
QR_PASSWORD=uma-senha-forte
BOT_NAME=RiftControl
PORT=3000
```

A chave `SERVICE_ROLE` fica somente no servidor. Nunca coloque essa chave em site público ou frontend.

---

## 3. Enviar para o GitHub pelo Termux

Entre na pasta do projeto e rode:

```bash
git init
git branch -M main
git add .
git commit -m "Versao inicial do RiftControl"
git remote add origin https://github.com/SEU_USUARIO/riftcontrol-bot.git
git push -u origin main
```

Se pedir nome/email do Git:

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seuemail@gmail.com"
```

---

## 4. Deploy no Back4App Containers

1. Entre no Back4App
2. Vá em Containers
3. Conecte sua conta GitHub
4. Escolha o repositório `riftcontrol-bot`
5. Branch: `main`
6. Root directory: `/`
7. Cadastre as variáveis de ambiente
8. Crie o app

O projeto já tem `Dockerfile`, então o Back4App consegue construir o container.

---

## 5. Parear o WhatsApp

Depois do deploy, abra:

```txt
https://SEU-APP.back4app.io/qr?key=SUA_SENHA
```

No WhatsApp:

```txt
Configurações → Dispositivos conectados → Conectar dispositivo
```

Escaneie o QR Code.

---

## 6. Comandos do bot

### Menu

```txt
!menu
```

### Cadastro

```txt
!cadastrar DarkJungle esmeralda jungle
```

### Perfil

```txt
!perfil
```

### Registrar partida

```txt
!partida vitória 12/3/8 ranked jungle
```

Com extras:

```txt
!partida vitória 15/0/6 ranked adc mvp guilda
```

Extras disponíveis:

```txt
mvp
guilda
torneio
md3
```

### Ranking

```txt
!ranking
```

### Histórico

```txt
!historico
```

### Estatísticas

```txt
!stats
```

---

## 7. Pontuação

Base:

```txt
Vitória: +25 XP
Derrota: +8 XP
Ranked: +5 XP
Sem morrer: +10 XP
MVP: +15 XP
Partida com guilda: +10 XP
Torneio/MD3: +25 XP
```

Bônus por KDA:

```txt
KDA 1.0+: +5 XP
KDA 2.0+: +10 XP
KDA 4.0+: +15 XP
KDA 6.0+: +20 XP
KDA 10.0+: +30 XP
```

Cargos:

```txt
0 XP: Recruta
100 XP: Membro
300 XP: Elite
600 XP: Veterano
1000 XP: Lenda da Guilda
```

---

## Observação importante

Baileys usa conexão via WhatsApp Web/Dispositivos Conectados. Use apenas no seu grupo/guilda e não use para spam.
