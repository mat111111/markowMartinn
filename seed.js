// Contenido inicial de ejemplo. Se carga solo la primera vez (base vacía).
// Todo se puede cambiar después desde el panel de administración.

const SETTINGS = {
  siteName: 'Marina Aldao',
  currency: 'ARS',
  shippingCost: 4500,
  freeShippingFrom: 60000,
  contactEmail: 'contacto@marinaaldao.com.ar',
  notifyEmail: '',
  commentsEnabled: true,
  commentsModeration: false,
  commentRules:
    'Los comentarios son públicos. Se borran o editan los que incluyan insultos, discriminación, spam, publicidad o datos personales de otras personas.',
  paymentInstructions:
    'Cuando confirmes el pedido te escribimos por mail con el link de pago de Mercado Pago o los datos para transferencia. Los envíos salen dentro de las 72 h hábiles de acreditado el pago, con firma y dedicatoria si la pedís en las notas.',
};

const AUTHOR = {
  name: 'Marina Aldao',
  role: 'Escritora',
  heroLine: 'Novelas y cuentos sobre casas que guardan más de lo que dicen.',
  photo: '',
  location: 'Nació en Bahía Blanca en 1984. Vive en Buenos Aires.',
  bio:
    'Escribe ficción desde los veinte años y publicó su primer libro de cuentos a los treinta y cinco. Le interesan las familias vistas desde la cocina, los pueblos que se quedan sin tren y la manera en que una casa cambia cuando alguien deja de vivir en ella.\n\n' +
    'Estudió Letras en la Universidad Nacional del Sur y trabajó una década como correctora en editoriales independientes. Ese oficio le dejó una obsesión por la frase justa y la costumbre de leer en voz alta todo lo que escribe.\n\n' +
    'Coordina talleres de escritura presenciales y a distancia, y colabora con reseñas en suplementos culturales. Sus libros fueron traducidos al portugués y al italiano.',
  facts: [
    { label: 'Libros publicados', value: '4' },
    { label: 'Traducciones', value: 'Portugués, italiano' },
    { label: 'Talleres', value: 'Desde 2015' },
  ],
  quote: 'Escribo para entender qué pasa en una casa cuando nadie la mira.',
};

const SOCIALS = [
  { id: 's1', network: 'Instagram', handle: '@marinaaldao.libros', url: 'https://www.instagram.com/' },
  { id: 's2', network: 'Substack', handle: 'Cartas de la llanura', url: 'https://substack.com/' },
  { id: 's3', network: 'Goodreads', handle: 'Marina Aldao', url: 'https://www.goodreads.com/' },
  { id: 's4', network: 'YouTube', handle: 'Lecturas en voz alta', url: 'https://www.youtube.com/' },
];

const RECOMMENDATIONS = [
  {
    id: 'r1',
    title: 'Zama',
    author: 'Antonio Di Benedetto',
    note: 'La espera convertida en novela. Cada vez que me trabo con un personaje que no avanza, vuelvo a Diego de Zama.',
    link: '',
  },
  {
    id: 'r2',
    title: 'Pedro Páramo',
    author: 'Juan Rulfo',
    note: 'Un pueblo entero contado por sus muertos. Me enseñó que una novela corta puede tener la densidad de una saga.',
    link: '',
  },
  {
    id: 'r3',
    title: 'Los años',
    author: 'Annie Ernaux',
    note: 'Una vida escrita en primera persona del plural. La releo para pensar cómo se cuenta el tiempo sin fechas.',
    link: '',
  },
  {
    id: 'r4',
    title: 'El viento que arrasa',
    author: 'Selva Almada',
    note: 'Cuatro personajes, un taller mecánico y un día de calor. Es mi ejemplo favorito de diálogo que no explica nada.',
    link: '',
  },
];

const BOOKS = [
  {
    title: 'La casa de los relojes parados',
    subtitle: '',
    genre: 'Novela',
    year: 2025,
    publisher: 'Editorial Ventisca',
    pages: 312,
    format: 'Tapa blanda, 14 × 21 cm',
    price: 32900,
    stock: 40,
    cover_color: '#22344F',
    featured: 1,
    synopsis:
      'Tres hermanas vuelven a la casa familiar de Ingeniero White para vaciarla antes de venderla. En cada habitación hay un reloj detenido a una hora distinta, y ninguna de las tres quiere admitir que sabe por qué. Una novela sobre la herencia, lo que se calla en las sobremesas y el precio de quedarse.',
  },
  {
    title: 'Agua de pozo',
    subtitle: 'Cuentos',
    genre: 'Cuentos',
    year: 2022,
    publisher: 'Editorial Ventisca',
    pages: 184,
    format: 'Tapa blanda, 13 × 20 cm',
    price: 24500,
    stock: 25,
    cover_color: '#3D5A47',
    featured: 0,
    synopsis:
      'Nueve cuentos ambientados en pueblos del sudoeste bonaerense, donde el agua se saca a mano y las noticias llegan tarde. Una maestra que cuenta los días hasta la jubilación, un chico que aprende a manejar en un camino de tierra, una viuda que alquila la pieza del fondo.',
  },
  {
    title: 'El mapa incompleto',
    subtitle: '',
    genre: 'Novela',
    year: 2019,
    publisher: 'Ediciones del Estuario',
    pages: 268,
    format: 'Tapa blanda, 14 × 21 cm',
    price: 27800,
    stock: 8,
    cover_color: '#6E2B36',
    featured: 0,
    synopsis:
      'Un agrimensor jubilado recibe el encargo de terminar un plano que su padre dejó a medio hacer en 1962. Mientras recorre los campos que nadie terminó de medir, descubre que el mapa también registraba otras cosas: quién se fue, quién se quedó y quién nunca apareció.',
  },
  {
    title: 'Diario de la llanura',
    subtitle: 'Crónicas',
    genre: 'Crónicas',
    year: 2023,
    publisher: 'Ediciones del Estuario',
    pages: 156,
    format: 'Tapa blanda, 12 × 19 cm',
    price: 21000,
    stock: 0,
    cover_color: '#C49A3A',
    featured: 0,
    synopsis:
      'Un año de viajes en micro por la provincia de Buenos Aires, de estación en estación. Crónicas breves sobre ferias, clubes de barrio, almacenes de ramos generales y la gente que todavía los sostiene.',
  },
];

module.exports = { SETTINGS, AUTHOR, SOCIALS, RECOMMENDATIONS, BOOKS };
